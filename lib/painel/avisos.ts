import 'server-only';
import { randomUUID } from 'node:crypto';
import { bancoDaEmpresa, central, ErroApi, registrarErro } from '@/lib/db';
import { empresaPorId } from '@/lib/empresa';
import { pode, type Usuario } from '@/lib/sessao';
import { mascararTexto } from './crm';
import { auditar } from './gestao';

// Avisos para a Planee (08/10). A equipe da clínica marca uma mensagem com problema ("Avisar a Planee"); o sistema
// também abre avisos sozinho (comprovante suspeito, número em silêncio, envios falhando, token vencendo). Todas as
// empresas caem numa fila só no Interno Planee.
// LGPD (decisão 26): no banco central fica só o índice (empresa, tipo, estado, título curto, 4 últimos dígitos).
// O comentário, a conversa e o trecho da mensagem ficam no banco da empresa (avisos_detalhe).

export const TIPOS_EQUIPE: Record<string, string> = {
  sara_errou: 'A Sara errou',
  info_errada: 'Informação errada',
  problema_tecnico: 'Problema técnico',
  sugestao: 'Sugestão',
  outro: 'Outro',
};
export const TIPOS_SISTEMA: Record<string, string> = {
  comprovante_suspeito: 'Comprovante suspeito',
  numero_silencioso: 'Número sem mensagens',
  envios_falhando: 'Envios falhando',
  token_vencendo: 'Token de integração vencendo',
};
export const ESTADOS = ['aberto', 'em_analise', 'resolvido'] as const;
export type EstadoAviso = (typeof ESTADOS)[number];

export type Aviso = {
  id: string; empresa_id: string; empresa_nome: string | null; origem: 'equipe' | 'sistema'; tipo: string; tipo_nome: string;
  titulo: string; estado: EstadoAviso; criado_por: string | null; criado_em: string; responsavel: string | null;
  resposta: string | null; respondido_por: string | null; respondido_em: string | null; atualizado_em: string;
  ref: Record<string, unknown>; tem_detalhe: boolean;
};
export type DetalheAviso = { aviso: Aviso; comentario: string | null; numero_id: string | null; wa_id: string | null; wamid: string | null; trecho: string | null };

const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const texto = (v: unknown, max: number) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };

function limpar(r: Record<string, unknown>): Aviso {
  const tipo = String(r.tipo);
  return {
    id: String(r.id), empresa_id: String(r.empresa_id), empresa_nome: (r.empresa_nome as string) ?? null,
    origem: r.origem === 'sistema' ? 'sistema' : 'equipe', tipo, tipo_nome: TIPOS_EQUIPE[tipo] ?? TIPOS_SISTEMA[tipo] ?? tipo,
    titulo: String(r.titulo), estado: (ESTADOS as readonly string[]).includes(String(r.estado)) ? (r.estado as EstadoAviso) : 'aberto',
    criado_por: (r.criado_por as string) ?? null, criado_em: iso(r.criado_em) as string, responsavel: (r.responsavel as string) ?? null,
    resposta: (r.resposta as string) ?? null, respondido_por: (r.respondido_por as string) ?? null, respondido_em: iso(r.respondido_em),
    atualizado_em: iso(r.atualizado_em) as string, ref: (r.ref as Record<string, unknown>) ?? {}, tem_detalhe: Boolean(r.tem_detalhe),
  };
}

function faltaMigracao(e: unknown): never {
  if (semTabela(e)) throw new ErroApi(503, 'Os avisos ainda não foram instalados no banco (migrações 015 e 016).');
  throw e;
}

// ---- Equipe da clínica ----

export async function criarAvisoDaEquipe(u: Usuario, d: { tipo: unknown; comentario: unknown; numero_id?: unknown; wa_id?: unknown; wamid?: unknown; trecho?: unknown }) {
  if (!u.empresa) throw new ErroApi(400, 'Escolha uma empresa.');
  if (!pode(u, 'inbox.ver') && !pode(u, 'crm.ver')) throw new ErroApi(403, 'Você não tem acesso a esta empresa.');
  const tipo = String(d.tipo ?? '');
  if (!TIPOS_EQUIPE[tipo]) throw new ErroApi(400, 'Escolha o tipo do aviso.');
  const comentario = texto(d.comentario, 2000);
  if (!comentario || comentario.length < 3) throw new ErroApi(400, 'Escreva o que aconteceu (pelo menos 3 letras).');
  const numero = texto(d.numero_id, 30); const wa = texto(d.wa_id, 30)?.replace(/\D/g, '') || null;
  if (numero && !/^\d{5,30}$/.test(numero)) throw new ErroApi(400, 'Conversa inválida.');
  const id = randomUUID();
  // Detalhe primeiro, no banco da empresa: se o central falhar, não fica aviso apontando para o nada.
  try {
    await bancoDaEmpresa(u.empresa).query(
      `insert into avisos_detalhe (aviso_id, comentario, numero_id, wa_id, wamid, trecho, criado_por) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, comentario, numero, wa, texto(d.wamid, 200), texto(d.trecho, 600), u.nome]);
  } catch (e) { faltaMigracao(e); }
  const titulo = `${TIPOS_EQUIPE[tipo]}${wa ? ` · conversa ••${wa.slice(-4)}` : ''}`;
  try {
    await central().query(
      `insert into avisos (id, empresa_id, origem, tipo, titulo, criado_por, criado_por_id, ref, tem_detalhe)
       values ($1,$2,'equipe',$3,$4,$5,$6,$7,true)`,
      [id, u.empresa.id, tipo, titulo, u.nome, u.id, JSON.stringify({ numero_id: numero, wa_final: wa ? wa.slice(-4) : null, alvo: wa ? 'conversa' : null })]);
  } catch (e) {
    await bancoDaEmpresa(u.empresa).query('delete from avisos_detalhe where aviso_id = $1', [id]).catch(() => undefined);
    faltaMigracao(e);
  }
  return id;
}

// Os avisos que a equipe da empresa mandou, com a resposta da Planee e o comentário (lido no banco da empresa).
export type MeuAviso = Aviso & { comentario: string | null };
export async function meusAvisos(u: Usuario): Promise<MeuAviso[]> {
  if (!u.empresa) return [];
  let lista: Aviso[];
  try {
    const r = await central().query(
      `select a.*, null as empresa_nome from avisos a where a.empresa_id = $1 and a.origem = 'equipe'
        order by (a.estado = 'resolvido'), a.criado_em desc limit 60`, [u.empresa.id]);
    lista = r.rows.map(limpar);
  } catch (e) { if (semTabela(e)) return []; throw e; }
  const comentarios = new Map<string, string>();
  if (lista.length) {
    try {
      const d = await bancoDaEmpresa(u.empresa).query(
        'select aviso_id, comentario from avisos_detalhe where aviso_id = any($1::uuid[])', [lista.map((a) => a.id)]);
      for (const x of d.rows) comentarios.set(String(x.aviso_id), String(x.comentario ?? ''));
    } catch (e) { if (!semTabela(e)) registrarErro('meus avisos (comentários)', e); }
  }
  return lista.map((a) => ({ ...a, comentario: comentarios.get(a.id) ?? null }));
}

// ---- Planee (master) ----

function exigirMaster(u: Usuario) { if (!u.master) throw new ErroApi(403, 'Só a Planee (master) vê os avisos de todas as empresas.'); }

export async function listarAvisos(u: Usuario, filtro?: { estado?: string | null; empresa?: string | null }): Promise<Aviso[]> {
  exigirMaster(u);
  // Sem filtro: os que ainda pedem ação (aberto e em análise). "todos" traz também os resolvidos.
  const estado = filtro?.estado === 'todos' ? 'todos' : filtro?.estado && (ESTADOS as readonly string[]).includes(filtro.estado) ? filtro.estado : null;
  try {
    const r = await central().query(
      `select a.*, e.nome as empresa_nome from avisos a join empresas e on e.id = a.empresa_id
        where ($1::text = 'todos' or ($1::text is null and a.estado <> 'resolvido') or a.estado = $1) and ($2::text is null or a.empresa_id = $2)
        order by case a.estado when 'aberto' then 0 when 'em_analise' then 1 else 2 end, a.criado_em desc limit 300`,
      [estado, filtro?.empresa || null]);
    return r.rows.map(limpar);
  } catch (e) { if (semTabela(e)) return []; throw e; }
}

export async function abrirAviso(u: Usuario, id: string): Promise<DetalheAviso> {
  exigirMaster(u);
  if (!UUID.test(id)) throw new ErroApi(404, 'Aviso não encontrado.');
  let a: Aviso;
  try {
    const r = await central().query(`select a.*, e.nome as empresa_nome from avisos a join empresas e on e.id = a.empresa_id where a.id = $1`, [id]);
    if (!r.rowCount) throw new ErroApi(404, 'Aviso não encontrado.');
    a = limpar(r.rows[0]);
  } catch (e) { if (e instanceof ErroApi) throw e; faltaMigracao(e); }
  const vazio = { comentario: null, numero_id: null, wa_id: null, wamid: null, trecho: null };
  if (!a.tem_detalhe) return { aviso: a, ...vazio };
  const empresa = await empresaPorId(a.empresa_id);
  try {
    const d = await bancoDaEmpresa(empresa).query(`select comentario, numero_id, wa_id, wamid, trecho from avisos_detalhe where aviso_id = $1`, [id]);
    await auditar(central(), u, a.empresa_id, 'abrir_aviso', id, undefined).catch(() => undefined);
    const x = d.rows[0];
    if (!x) return { aviso: a, ...vazio };
    return {
      aviso: a, comentario: mascararTexto(String(x.comentario ?? '')), numero_id: x.numero_id ?? null, wa_id: x.wa_id ?? null,
      wamid: x.wamid ?? null, trecho: x.trecho ? mascararTexto(String(x.trecho)) : null,
    };
  } catch (e) {
    registrarErro('abrir aviso (detalhe)', e);
    return { aviso: a, ...vazio, comentario: 'Não foi possível ler o detalhe no banco da empresa agora.' };
  }
}

export async function atualizarAviso(u: Usuario, id: string, d: { estado?: unknown; resposta?: unknown; responsavel?: unknown }) {
  exigirMaster(u);
  if (!UUID.test(id)) throw new ErroApi(404, 'Aviso não encontrado.');
  const estado = d.estado === undefined ? undefined : String(d.estado);
  if (estado !== undefined && !(ESTADOS as readonly string[]).includes(estado)) throw new ErroApi(400, 'Estado inválido.');
  const resposta = d.resposta === undefined ? undefined : texto(d.resposta, 2000);
  const responsavel = d.responsavel === undefined ? undefined : texto(d.responsavel, 80);
  const r = await central().query(
    `update avisos set estado = coalesce($2, estado),
            responsavel = case when $4::boolean then $3 else coalesce(responsavel, $5) end,
            resposta = case when $7::boolean then $6 else resposta end,
            respondido_por = case when $7::boolean then $5 else respondido_por end,
            respondido_em = case when $7::boolean then now() else respondido_em end,
            atualizado_em = now()
      where id = $1 returning empresa_id`,
    [id, estado ?? null, responsavel ?? null, responsavel !== undefined, u.nome, resposta ?? null, resposta !== undefined]);
  if (!r.rowCount) throw new ErroApi(404, 'Aviso não encontrado.');
  await auditar(central(), u, r.rows[0].empresa_id, 'atualizar_aviso', id, { estado, respondeu: resposta !== undefined }).catch(() => undefined);
}

// Os automáticos (comprovante suspeito, número em silêncio, envios falhando, token vencendo) estão em lib/avisos-sistema.ts.
export { avisoDoSistema } from '@/lib/avisos-sistema';
