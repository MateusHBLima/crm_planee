import 'server-only';
import type { PoolClient } from 'pg';
import { ErroApi, transacao } from '@/lib/db';
import { bancoDe, type Chave } from './auth';
import { auditar, exigirEscopo, quando, texto } from './servico';

// Redes sociais (migração 034, 23/11). Quem recebe da Meta, do Google e do TikTok é o n8n da empresa; ele grava aqui:
//   GET  /api/v1/redes/contas                      contas conectadas
//   POST /api/v1/redes/contas      {rede, conta_id, usuario?, nome?, responder_url?, ativa?}
//   POST /api/v1/redes/mensagens   {rede, conta_id, pessoa:{id, usuario?, nome?}, mid, direcao, origem, tipo?, texto?,
//                                   midia_url?, resposta_a?, enviada_em?, por?}        (mesmo mid = repetido)
//   POST /api/v1/redes/comentarios {rede, conta_id, comentario_id, texto?, comentado_em?, post?:{id, url, titulo},
//                                   autor?:{id, usuario, nome}, resposta_publica?, respondido_em?, respondido_por?,
//                                   direct_enviado?, situacao?, erro?}                 (mesmo comentario_id atualiza)

export const REDES = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;
export type Rede = (typeof REDES)[number];
const ID_EXTERNO = /^[A-Za-z0-9_.:@-]{1,120}$/;
const URL_OK = /^https?:\/\/[^\s]{3,500}$/;
const TIPOS = ['texto', 'imagem', 'video', 'audio', 'arquivo', 'story', 'outro'];
const SITUACOES = ['novo', 'respondido', 'ignorado', 'oculto', 'erro'];

const falta034 = () => new ErroApi(503, 'As redes sociais ainda não foram instaladas no banco desta empresa (migração 034).');
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const objeto = (corpo: unknown) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Envie um objeto JSON.');
  return corpo as Record<string, unknown>;
};
function rede(v: unknown): Rede {
  const r = String(v ?? '').toLowerCase();
  if (!(REDES as readonly string[]).includes(r)) throw new ErroApi(400, `rede: use ${REDES.join(', ')}.`);
  return r as Rede;
}
function externo(v: unknown, campo: string): string {
  const s = String(v ?? '').trim();
  if (!ID_EXTERNO.test(s)) throw new ErroApi(400, `${campo}: obrigatório, até 120 caracteres (letras, números, _ . : @ -).`);
  return s;
}
const usuarioDe = (v: unknown) => { const s = texto(v, 80); return s ? s.replace(/^@+/, '') : null; };
const urlDe = (v: unknown, campo: string) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!URL_OK.test(s)) throw new ErroApi(400, `${campo}: endereço http(s) inválido.`);
  return s;
};
export const idConta = (r: Rede, contaExterna: string) => `${r}:${contaExterna}`;

async function comBanco<T>(chave: Chave, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  try { return await transacao(fn, bancoDe(chave)); } catch (e) { if (semTabela(e)) throw falta034(); throw e; }
}

// Cria a conta na primeira vez que ela aparece (o n8n não precisa cadastrar antes) e devolve o id.
async function garantirConta(c: PoolClient, r: Rede, contaExterna: string, extra: { usuario?: string | null; nome?: string | null } = {}) {
  const id = idConta(r, contaExterna);
  await c.query(
    `insert into rs_contas (id, rede, conta_externa, usuario, nome) values ($1, $2, $3, $4, $5)
     on conflict (id) do update set usuario = coalesce(excluded.usuario, rs_contas.usuario),
       nome = coalesce(excluded.nome, rs_contas.nome), atualizado_em = now()`,
    [id, r, contaExterna, extra.usuario ?? null, extra.nome ?? null]);
  return id;
}

const contaPublica = (x: Record<string, unknown>) => ({
  id: String(x.id), rede: String(x.rede), conta_id: String(x.conta_externa), usuario: x.usuario == null ? null : String(x.usuario),
  nome: x.nome == null ? null : String(x.nome), responder: Boolean(x.responder_url), ativa: Boolean(x.ativa),
});

export async function listarContas(chave: Chave) {
  exigirEscopo(chave, 'leitura');
  try {
    const r = await bancoDe(chave).query('select * from rs_contas order by rede, criado_em');
    return { itens: r.rows.map(contaPublica) };
  } catch (e) { if (semTabela(e)) throw falta034(); throw e; }
}

export async function salvarConta(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = objeto(corpo);
  const r = rede(d.rede);
  const contaExterna = externo(d.conta_id, 'conta_id');
  const usuario = usuarioDe(d.usuario);
  const nome = texto(d.nome, 120);
  const temResponder = Object.prototype.hasOwnProperty.call(d, 'responder_url');
  const responder = temResponder ? urlDe(d.responder_url, 'responder_url') : null;
  const ativa = d.ativa === undefined ? null : Boolean(d.ativa);
  return comBanco(chave, async (c) => {
    const id = await garantirConta(c, r, contaExterna, { usuario, nome });
    await c.query(
      `update rs_contas set responder_url = case when $2 then $3 else responder_url end,
         ativa = coalesce($4, ativa), atualizado_em = now() where id = $1`, [id, temResponder, responder, ativa]);
    await auditar(c, chave, 'salvar', 'redes_contas', id, { rede: r, usuario, responder: temResponder ? Boolean(responder) : undefined, ativa });
    const x = await c.query('select * from rs_contas where id = $1', [id]);
    return contaPublica(x.rows[0]);
  });
}

const RESUMO: Record<string, string> = { imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', arquivo: 'Arquivo', story: 'Resposta ao story', outro: 'Mensagem' };
export const resumoDe = (tipo: string, t: string | null) => (t ? t.replace(/\s+/g, ' ').slice(0, 200) : RESUMO[tipo] ?? 'Mensagem');

// Grava uma mensagem do direct e atualiza a linha da conversa. Mesmo mid devolve o que já existe (repetido = true).
export async function gravarMensagemNaConversa(c: PoolClient, m: {
  contaId: string; pessoa: { id: string; usuario?: string | null; nome?: string | null }; mid: string;
  direcao: 'entrada' | 'saida'; origem: string; por?: string | null; tipo: string; texto: string | null;
  midiaUrl?: string | null; respostaA?: string | null; enviadaEm: string;
}): Promise<{ id: string; repetido: boolean }> {
  const ins = await c.query(
    `insert into rs_mensagens (conta_id, pessoa_id, mid, direcao, origem, por, tipo, texto, midia_url, resposta_a, enviada_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (conta_id, mid) do nothing returning id`,
    [m.contaId, m.pessoa.id, m.mid, m.direcao, m.origem, m.por ?? null, m.tipo, m.texto, m.midiaUrl ?? null, m.respostaA ?? null, m.enviadaEm]);
  if (!ins.rowCount) {
    const r = await c.query('select id from rs_mensagens where conta_id = $1 and mid = $2', [m.contaId, m.mid]);
    return { id: String(r.rows[0].id), repetido: true };
  }
  const entrada = m.direcao === 'entrada';
  // A linha da conversa só avança com mensagem mais nova (o n8n pode mandar fora de ordem).
  await c.query(
    `insert into rs_conversas (conta_id, pessoa_id, usuario, nome, ultima_em, ultima_resumo, ultima_direcao, ultima_entrada_em, nao_lidas)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8 then $5::timestamptz end, case when $8 then 1 else 0 end)
     on conflict (conta_id, pessoa_id) do update set
       usuario = coalesce(excluded.usuario, rs_conversas.usuario),
       nome = coalesce(excluded.nome, rs_conversas.nome),
       ultima_resumo = case when rs_conversas.ultima_em is null or excluded.ultima_em >= rs_conversas.ultima_em then excluded.ultima_resumo else rs_conversas.ultima_resumo end,
       ultima_direcao = case when rs_conversas.ultima_em is null or excluded.ultima_em >= rs_conversas.ultima_em then excluded.ultima_direcao else rs_conversas.ultima_direcao end,
       ultima_em = greatest(rs_conversas.ultima_em, excluded.ultima_em),
       ultima_entrada_em = case when $8 then greatest(rs_conversas.ultima_entrada_em, excluded.ultima_em) else rs_conversas.ultima_entrada_em end,
       nao_lidas = case when $8 and (rs_conversas.lida_ate is null or excluded.ultima_em > rs_conversas.lida_ate) then rs_conversas.nao_lidas + 1
                        when not $8 then 0 else rs_conversas.nao_lidas end,
       arquivada = false`,
    [m.contaId, m.pessoa.id, m.pessoa.usuario ?? null, m.pessoa.nome ?? null, m.enviadaEm, resumoDe(m.tipo, m.texto), m.direcao, entrada]);
  return { id: String(ins.rows[0].id), repetido: false };
}

export async function gravarMensagem(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = objeto(corpo);
  const r = rede(d.rede);
  const contaExterna = externo(d.conta_id, 'conta_id');
  const p = objeto(d.pessoa ?? null);
  const pessoa = { id: externo(p.id, 'pessoa.id'), usuario: usuarioDe(p.usuario), nome: texto(p.nome, 120) };
  const mid = externo(d.mid, 'mid');
  const direcao = String(d.direcao ?? '');
  if (direcao !== 'entrada' && direcao !== 'saida') throw new ErroApi(400, 'direcao: use "entrada" (da pessoa) ou "saida" (da empresa).');
  const origem = String(d.origem ?? (direcao === 'entrada' ? 'contato' : ''));
  const validas = direcao === 'entrada' ? ['contato'] : ['ia', 'painel', 'app'];
  if (!validas.includes(origem)) throw new ErroApi(400, `origem: para ${direcao}, use ${validas.join(', ')}.`);
  const tipo = String(d.tipo ?? 'texto');
  if (!TIPOS.includes(tipo)) throw new ErroApi(400, `tipo: use ${TIPOS.join(', ')}.`);
  const t = texto(d.texto, 4000);
  const enviadaEm = quando(d.enviada_em, 'enviada_em') ?? new Date().toISOString();
  return comBanco(chave, async (c) => {
    const contaId = await garantirConta(c, r, contaExterna);
    const res = await gravarMensagemNaConversa(c, {
      contaId, pessoa, mid, direcao, origem, por: texto(d.por, 80), tipo, texto: t,
      midiaUrl: urlDe(d.midia_url, 'midia_url'), respostaA: d.resposta_a ? externo(d.resposta_a, 'resposta_a') : null, enviadaEm,
    });
    return { ...res, conta_id: contaId };
  });
}

export async function gravarComentario(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = objeto(corpo);
  const r = rede(d.rede);
  const contaExterna = externo(d.conta_id, 'conta_id');
  const comentarioId = externo(d.comentario_id, 'comentario_id');
  const post = d.post && typeof d.post === 'object' ? d.post as Record<string, unknown> : {};
  const autor = d.autor && typeof d.autor === 'object' ? d.autor as Record<string, unknown> : {};
  const situacao = d.situacao === undefined ? null : String(d.situacao);
  if (situacao !== null && !SITUACOES.includes(situacao)) throw new ErroApi(400, `situacao: use ${SITUACOES.join(', ')}.`);
  const resposta = texto(d.resposta_publica, 2000);
  const respondidoEm = quando(d.respondido_em, 'respondido_em') ?? (resposta ? new Date().toISOString() : null);
  return comBanco(chave, async (c) => {
    const contaId = await garantirConta(c, r, contaExterna);
    const x = await c.query(
      `insert into rs_comentarios (conta_id, comentario_id, post_id, post_url, post_titulo, autor_id, autor_usuario, autor_nome, texto,
         comentado_em, resposta_publica, respondido_em, respondido_por, direct_enviado, situacao, erro)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11, $12, $13, coalesce($14, false),
         coalesce($15, case when $11::text is not null then 'respondido' else 'novo' end), $16)
       on conflict (conta_id, comentario_id) do update set
         post_id = coalesce(excluded.post_id, rs_comentarios.post_id), post_url = coalesce(excluded.post_url, rs_comentarios.post_url),
         post_titulo = coalesce(excluded.post_titulo, rs_comentarios.post_titulo),
         autor_id = coalesce(excluded.autor_id, rs_comentarios.autor_id), autor_usuario = coalesce(excluded.autor_usuario, rs_comentarios.autor_usuario),
         autor_nome = coalesce(excluded.autor_nome, rs_comentarios.autor_nome), texto = coalesce(excluded.texto, rs_comentarios.texto),
         resposta_publica = coalesce(excluded.resposta_publica, rs_comentarios.resposta_publica),
         respondido_em = coalesce(excluded.respondido_em, rs_comentarios.respondido_em),
         respondido_por = coalesce(excluded.respondido_por, rs_comentarios.respondido_por),
         direct_enviado = rs_comentarios.direct_enviado or excluded.direct_enviado,
         situacao = case when $15::text is not null then $15
                         when excluded.resposta_publica is not null and rs_comentarios.situacao = 'novo' then 'respondido'
                         else rs_comentarios.situacao end,
         erro = coalesce($16, rs_comentarios.erro), atualizado_em = now()
       returning id, (xmax = 0) as novo, situacao`,
      [contaId, comentarioId, d.post_id !== undefined ? texto(d.post_id, 120) : texto(post.id, 120), urlDe(post.url, 'post.url'), texto(post.titulo, 300),
        texto(autor.id, 120), usuarioDe(autor.usuario), texto(autor.nome, 120), texto(d.texto, 4000), quando(d.comentado_em, 'comentado_em'),
        resposta, respondidoEm, texto(d.respondido_por, 80), d.direct_enviado === undefined ? null : Boolean(d.direct_enviado), situacao, texto(d.erro, 500)]);
    return { id: String(x.rows[0].id), repetido: !x.rows[0].novo, situacao: String(x.rows[0].situacao), conta_id: contaId };
  });
}
