import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transacao, ErroApi, empresaDoBancoPadrao } from '@/lib/db';
import { avisoDoSistema } from '@/lib/avisos-sistema';
import { resumoParaFicha } from '@/lib/automaticas';
import { recurso as acharRecurso, type Recurso } from './recursos';
import { bancoDe, type Chave } from './auth';
import { tentarArquivoDoWhatsApp } from './comprovante-whatsapp';
import { chaveTelefone, normalizarTelefone, SQL_MESMO_TELEFONE } from '@/lib/telefone';

// Operações da API. A rota HTTP e o conector MCP usam exatamente estas funções.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_TEXTO = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function exigirRecurso(nome: string): Recurso {
  const r = acharRecurso(nome);
  if (!r) throw new ErroApi(404, `Recurso "${nome}" não existe. Veja GET /api/v1 para a lista.`);
  return r;
}

function validarId(r: Recurso, id: string) {
  const ok = r.idTipo === 'uuid' ? UUID.test(id) : ID_TEXTO.test(id);
  if (!ok) throw new ErroApi(400, r.idTipo === 'uuid' ? 'id inválido: esperado uuid.' : 'id inválido: use letras minúsculas, números, _ ou -.');
}

export function exigirEscopo(chave: Chave, escopo: string) {
  if (!chave.escopos.includes(escopo)) {
    throw new ErroApi(403, chave.usuario_id ? 'Você não tem permissão para isso nesta empresa.' : `Esta chave não tem o escopo "${escopo}".`);
  }
}

function limparDados(r: Recurso, dados: unknown): Record<string, unknown> {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new ErroApi(400, 'Envie um objeto JSON com os campos.');
  const saida: Record<string, unknown> = {};
  const desconhecidos: string[] = [];
  for (const [k, v] of Object.entries(dados as Record<string, unknown>)) {
    if (k === 'id' || k === 'arquivado') continue;
    if (Object.prototype.hasOwnProperty.call(r.campos, k)) saida[k] = v;
    else desconhecidos.push(k);
  }
  if (desconhecidos.length) throw new ErroApi(400, `Campos que não existem em ${r.nome}: ${desconhecidos.join(', ')}.`, { campos_validos: Object.keys(r.campos) });
  return saida;
}

function traduzErroBanco(e: unknown): never {
  const err = e as { code?: string; detail?: string; message?: string; constraint?: string };
  if (err && err.code === '23505') throw new ErroApi(409, 'Já existe um registro com esse valor.', err.detail);
  if (err && err.code === '23503') throw new ErroApi(400, 'Referência inválida: o registro ligado não existe.', err.detail);
  if (err && err.code === '23514') throw new ErroApi(400, 'Valor fora do permitido.', err.constraint); // sem detail: ele traz a linha inteira
  if (err && err.code === '22P02') throw new ErroApi(400, 'Formato de valor inválido.');
  throw e;
}

export async function auditar(c: PoolClient, chave: Chave, acao: string, recurso: string, alvo: string | null, detalhe: unknown) {
  const d = detalhe === undefined ? null : JSON.stringify(detalhe);
  // Escrita feita por uma pessoa no painel grava usuario_id (coluna da migração 003).
  if (chave.usuario_id) {
    await c.query(
      'insert into painel_auditoria (usuario_id, acao, recurso, alvo_id, detalhe) values ($1,$2,$3,$4,$5)',
      [chave.usuario_id, acao, recurso, alvo, d],
    );
    return;
  }
  await c.query(
    'insert into painel_auditoria (chave_id, acao, recurso, alvo_id, detalhe) values ($1,$2,$3,$4,$5)',
    [chave.id, acao, recurso, alvo, d],
  );
}

// CPF/CNPJ inteiro não sai pela API nem pelo MCP: só os 2 últimos dígitos (auditoria 01/10, S6). O filtro por
// documento continua funcionando; quem precisa do número inteiro olha no painel.
function protegerDoc<T extends Record<string, unknown> | undefined>(tabela: string, linha: T): T {
  if (tabela !== 'contatos' || !linha || !linha.documento) return linha;
  return { ...linha, documento: '***' + String(linha.documento).replace(/\D/g, '').slice(-2) };
}

export async function listar(chave: Chave, nome: string, filtros: Record<string, string> = {}, limite = 50, deslocamento = 0) {
  exigirEscopo(chave, 'leitura');
  const r = exigirRecurso(nome);
  const where: string[] = [];
  const vals: unknown[] = [];
  const f = { ...filtros };
  if (!('arquivado' in f)) f.arquivado = 'false';
  for (const [k, v] of Object.entries(f)) {
    if (!r.filtros.includes(k)) throw new ErroApi(400, `Filtro "${k}" não existe em ${r.nome}. Filtros: ${r.filtros.join(', ')}.`);
    vals.push(k === 'arquivado' ? v === 'true' : v);
    where.push(`${k} = $${vals.length}`);
  }
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const off = Math.max(Number(deslocamento) || 0, 0);
  const sql = `select * from ${r.tabela} ${where.length ? 'where ' + where.join(' and ') : ''} order by ${r.ordem} limit ${lim} offset ${off}`;
  try {
    const res = await bancoDe(chave).query(sql, vals);
    return { itens: res.rows.map((x) => protegerDoc(r.tabela, x)), limite: lim, deslocamento: off };
  } catch (e) { traduzErroBanco(e); }
}

export async function obter(chave: Chave, nome: string, id: string) {
  exigirEscopo(chave, 'leitura');
  const r = exigirRecurso(nome);
  validarId(r, id);
  const res = await bancoDe(chave).query(`select * from ${r.tabela} where id = $1`, [id]);
  if (!res.rowCount) throw new ErroApi(404, `${r.nome}/${id} não encontrado.`);
  return protegerDoc(r.tabela, res.rows[0]);
}

export async function criar(chave: Chave, nome: string, corpo: unknown) {
  if (nome === 'pagamentos') return criarPagamento(chave, corpo);
  const r = exigirRecurso(nome);
  exigirEscopo(chave, r.escrita);
  const dados = limparDados(r, corpo);
  const cols = Object.keys(dados);
  const vals = Object.values(dados);
  if (r.idObrigatorioNaCriacao) {
    const id = (corpo as Record<string, unknown>).id;
    if (typeof id !== 'string') throw new ErroApi(400, `Informe "id" (texto curto, ex.: "receita") para criar em ${r.nome}.`);
    validarId(r, id);
    cols.unshift('id'); vals.unshift(id);
  }
  if (!cols.length) throw new ErroApi(400, 'Nenhum campo informado.');
  const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
  try {
    return await transacao(async (c) => {
      const res = await c.query(`insert into ${r.tabela} (${cols.join(', ')}) values (${ph}) returning *`, vals);
      await auditar(c, chave, 'criar', r.nome, String(res.rows[0].id), dados);
      return protegerDoc(r.tabela, res.rows[0]);
    }, bancoDe(chave));
  } catch (e) { if (e instanceof ErroApi) throw e; traduzErroBanco(e); }
}

export async function atualizar(chave: Chave, nome: string, id: string, corpo: unknown) {
  if (nome === 'pagamentos') return atualizarPagamento(chave, id, corpo);
  const r = exigirRecurso(nome);
  exigirEscopo(chave, r.escrita);
  validarId(r, id);
  const dados = limparDados(r, corpo);
  const cols = Object.keys(dados);
  if (!cols.length) throw new ErroApi(400, 'Nenhum campo para atualizar.');
  const sets = cols.map((k, i) => `${k} = $${i + 2}`);
  sets.push('atualizado_em = now()');
  if (r.nome === 'atendimentos' && 'etapa' in dados) {
    sets.push(`finalizado_em = case when $${cols.indexOf('etapa') + 2} = 'finalizado' then now() else null end`);
  }
  try {
    return await transacao(async (c) => {
      const res = await c.query(`update ${r.tabela} set ${sets.join(', ')} where id = $1 returning *`, [id, ...Object.values(dados)]);
      if (!res.rowCount) throw new ErroApi(404, `${r.nome}/${id} não encontrado.`);
      await auditar(c, chave, 'atualizar', r.nome, id, dados);
      return protegerDoc(r.tabela, res.rows[0]);
    }, bancoDe(chave));
  } catch (e) { if (e instanceof ErroApi) throw e; traduzErroBanco(e); }
}

// Assumir um atendimento de forma atômica: trava a linha, confere que ainda está em "aguardando"
// e só então muda. Duas pessoas clicando ao mesmo tempo: a segunda recebe 409 com o nome da primeira.
export async function assumirAtendimento(chave: Chave, id: string, responsavel: string) {
  exigirEscopo(chave, 'crm');
  validarId(RECURSO_ATENDIMENTOS(), id);
  return transacao(async (c) => {
    const atual = await c.query('select etapa, responsavel from atendimentos where id = $1 and not arquivado for update', [id]);
    if (!atual.rowCount) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
    const { etapa, responsavel: quem } = atual.rows[0];
    if (etapa !== 'aguardando') {
      throw new ErroApi(409, quem ? `${quem} já assumiu este atendimento.` : 'Este atendimento já saiu de "aguardando".');
    }
    const res = await c.query(
      `update atendimentos set etapa = 'em_atendimento', responsavel = $2, assumido_em = coalesce(assumido_em, now()),
              finalizado_em = null, atualizado_em = now() where id = $1 returning *`,
      [id, responsavel],
    );
    await auditar(c, chave, 'atualizar', 'atendimentos', id, { etapa: 'em_atendimento', responsavel });
    return res.rows[0];
  }, bancoDe(chave));
}
const RECURSO_ATENDIMENTOS = () => exigirRecurso('atendimentos');

export async function arquivar(chave: Chave, nome: string, id: string) {
  const r = exigirRecurso(nome);
  exigirEscopo(chave, r.escrita);
  validarId(r, id);
  return transacao(async (c) => {
    if (r.nome === 'etapas') {
      const alvo = await c.query('select tipo from crm_etapas where id = $1 and not arquivado', [id]);
      if (alvo.rowCount) {
        const outras = await c.query('select count(*)::int n from crm_etapas where tipo = $1 and id <> $2 and not arquivado', [alvo.rows[0].tipo, id]);
        if (outras.rows[0].n === 0) throw new ErroApi(409, `O funil precisa de pelo menos uma etapa do tipo "${alvo.rows[0].tipo}".`);
      }
    }
    const res = await c.query(`update ${r.tabela} set arquivado = true, atualizado_em = now() where id = $1 returning *`, [id]);
    if (!res.rowCount) throw new ErroApi(404, `${r.nome}/${id} não encontrado.`);
    await auditar(c, chave, 'arquivar', r.nome, id, null);
    return protegerDoc(r.tabela, res.rows[0]);
  }, bancoDe(chave));
}

export async function lerConfig(chave: Chave, nomeChave?: string) {
  exigirEscopo(chave, 'leitura');
  if (nomeChave) {
    const res = await bancoDe(chave).query('select chave, valor, atualizado_em from crm_config where chave = $1', [nomeChave]);
    if (!res.rowCount) throw new ErroApi(404, `Configuração "${nomeChave}" não existe.`);
    return res.rows[0];
  }
  const res = await bancoDe(chave).query('select chave, valor, atualizado_em from crm_config order by chave');
  return { itens: res.rows };
}

export async function definirConfig(chave: Chave, nomeChave: string, valor: unknown) {
  exigirEscopo(chave, 'config');
  if (!ID_TEXTO.test(nomeChave)) throw new ErroApi(400, 'Nome de configuração inválido: use letras minúsculas, números, _ ou -.');
  if (valor === undefined) throw new ErroApi(400, 'Envie {"valor": ...}.');
  return transacao(async (c) => {
    const res = await c.query(
      `insert into crm_config (chave, valor) values ($1, $2)
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now() returning *`,
      [nomeChave, JSON.stringify(valor)],
    );
    await auditar(c, chave, 'definir', 'config', nomeChave, valor);
    return res.rows[0];
  }, bancoDe(chave));
}

// ---- Para o agente de IA (Sara): ler a ficha e mover o funil pelo telefone ----

// Tudo o que o CRM sabe de um telefone, em uma chamada: quem é, desde quando, atendimentos abertos e
// recentes, notas, oportunidades e as etapas do funil. CPF sai só com o final (LGPD: o agente não precisa do resto).
export async function ficha(chave: Chave, telefone: unknown) {
  exigirEscopo(chave, 'leitura');
  const tel = normalizarTelefone(telefone);
  const db = bancoDe(chave);
  const cont = await db.query(
    `select id, nome, telefone, documento, tipo_documento, criado_em from contatos
      where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em`,
    chaveTelefone(tel),
  );
  const etapas = await db.query(`select id, nome, tipo, ordem from crm_etapas where not arquivado order by ordem, nome`);
  if (!cont.rowCount) return { encontrado: false, telefone: tel, contatos: [], etapas_funil: etapas.rows, automaticas: { permitidas: true, desde: null, motivo: null, por: null, ultimos_envios: [] } };
  const ids = cont.rows.map((c) => c.id);
  const [atend, ops, notas] = await Promise.all([
    db.query(
      `select a.id, a.contato_id, a.topico_id, t.nome as assunto, a.etapa, a.resumo, a.responsavel, a.aberto_por,
              a.aberto_em, a.finalizado_em
         from atendimentos a left join crm_topicos t on t.id = a.topico_id
        where a.contato_id = any($1) and not a.arquivado
        order by (a.etapa <> 'finalizado') desc, a.aberto_em desc limit 15`, [ids]),
    db.query(
      `select o.id, o.contato_id, o.interesse, o.valor, o.etapa_id, e.nome as etapa, e.tipo as etapa_tipo, o.criado_em, o.atualizado_em
         from oportunidades o left join crm_etapas e on e.id = o.etapa_id
        where o.contato_id = any($1) and not o.arquivado order by o.atualizado_em desc limit 10`, [ids]),
    db.query(
      `select n.alvo_tipo, n.alvo_id, n.texto, n.autor, n.criado_em from notas n
        where not n.arquivado and ((n.alvo_tipo = 'contatos' and n.alvo_id = any($1))
           or (n.alvo_tipo = 'atendimentos' and n.alvo_id in (select id from atendimentos where contato_id = any($1)))
           or (n.alvo_tipo = 'oportunidades' and n.alvo_id in (select id from oportunidades where contato_id = any($1))))
        order by n.criado_em desc limit 15`, [ids]),
  ]);
  // Serviços e pagamentos (migração 013): banco sem eles devolve as listas vazias.
  const [servs, pags] = await Promise.all([
    db.query(
      `select id, contato_id, tipo, descricao, inicio, profissional, local, valor, situacao, sistema, codigo_externo, criado_em
         from servicos where contato_id = any($1) and not arquivado order by inicio desc nulls last, criado_em desc limit 20`, [ids])
      .catch((e) => { if ((e as { code?: string }).code === '42P01') return { rows: [] }; throw e; }),
    db.query(
      `select id, contato_id, servico_id, valor, pago_em, forma, descricao, analise, analise_motivos, conferido_em, conferido_por, criado_em,
              arquivo_nome is not null as tem_arquivo
         from pagamentos where contato_id = any($1) and not arquivado order by criado_em desc limit 20`, [ids])
      .catch((e) => { if ((e as { code?: string }).code === '42P01') return { rows: [] }; throw e; }),
  ]);
  // Mensagens automáticas (migração 017): se pode enviar e os últimos envios. A IA confere antes de cada envio.
  const automaticas = await resumoParaFicha(db, ids);
  return {
    encontrado: true,
    telefone: tel,
    automaticas,
    servicos: servs.rows.map((x) => ({ ...x, valor: x.valor === null ? null : Number(x.valor) })),
    pagamentos: pags.rows.map((x) => ({ ...x, valor: x.valor === null ? null : Number(x.valor) })),
    contatos: cont.rows.map((c) => ({
      id: c.id, nome: c.nome, contato_desde: c.criado_em,
      cpf_final: c.documento ? String(c.documento).replace(/\D/g, '').slice(-3) : null,
    })),
    atendimentos_abertos: atend.rows.filter((a) => a.etapa !== 'finalizado'),
    atendimentos_recentes: atend.rows.filter((a) => a.etapa === 'finalizado'),
    oportunidades: ops.rows.map((o) => ({ ...o, valor: o.valor === null ? null : Number(o.valor) })),
    notas: notas.rows,
    etapas_funil: etapas.rows,
  };
}

// Coloca o telefone numa etapa do funil comercial: move a oportunidade em aberto dele ou cria uma.
// Cria o contato se ainda não existir. Tudo numa transação, com auditoria.
export async function moverNoFunil(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  if (!corpo || typeof corpo !== 'object') throw new ErroApi(400, 'Envie {"telefone", "etapa_id", "interesse"?, "valor"?, "nome"?}.');
  const d = corpo as Record<string, unknown>;
  const tel = normalizarTelefone(d.telefone);
  const etapaId = String(d.etapa_id ?? '');
  if (!ID_TEXTO.test(etapaId)) throw new ErroApi(400, 'Informe "etapa_id" (veja etapas_funil na ficha).');
  const valor = d.valor === undefined || d.valor === null || d.valor === '' ? undefined : Number(d.valor);
  if (valor !== undefined && (!Number.isFinite(valor) || valor < 0)) throw new ErroApi(400, 'Valor inválido.');
  const interesse = d.interesse === undefined ? undefined : String(d.interesse ?? '').trim().slice(0, 300) || null;
  const nome = String(d.nome ?? '').trim().slice(0, 120) || null;
  return transacao(async (c) => {
    const et = await c.query('select id, nome, tipo from crm_etapas where id = $1 and not arquivado', [etapaId]);
    if (!et.rowCount) throw new ErroApi(400, `Etapa "${etapaId}" não existe no funil.`);
    let cont = await c.query(`select id, nome from contatos where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em limit 1`, chaveTelefone(tel));
    let contatoId: string;
    if (cont.rowCount) {
      contatoId = cont.rows[0].id;
      if (nome && !cont.rows[0].nome) await c.query('update contatos set nome = $2, atualizado_em = now() where id = $1', [contatoId, nome]);
    } else {
      cont = await c.query('insert into contatos (telefone, nome) values ($1, $2) returning id', [tel, nome]);
      contatoId = cont.rows[0].id;
      await auditar(c, chave, 'criar', 'contatos', contatoId, { telefone: tel, nome });
    }
    // A oportunidade "viva" é a mais recente que não está arquivada nem fechada (ganho/perdido).
    const viva = await c.query(
      `select o.id, o.etapa_id from oportunidades o join crm_etapas e on e.id = o.etapa_id
        where o.contato_id = $1 and not o.arquivado and e.tipo = 'aberta' order by o.atualizado_em desc limit 1 for update of o`, [contatoId]);
    const campos: Record<string, unknown> = { etapa_id: etapaId };
    if (interesse !== undefined) campos.interesse = interesse;
    if (valor !== undefined) campos.valor = valor;
    let op;
    if (viva.rowCount) {
      const cols = Object.keys(campos);
      const res = await c.query(
        `update oportunidades set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, atualizado_em = now() where id = $1 returning *`,
        [viva.rows[0].id, ...Object.values(campos)]);
      op = res.rows[0];
      await auditar(c, chave, 'atualizar', 'oportunidades', op.id, { de: viva.rows[0].etapa_id, ...campos });
    } else {
      const res = await c.query(
        'insert into oportunidades (contato_id, etapa_id, interesse, valor) values ($1, $2, $3, $4) returning *',
        [contatoId, etapaId, interesse ?? null, valor ?? null]);
      op = res.rows[0];
      await auditar(c, chave, 'criar', 'oportunidades', op.id, { contato_id: contatoId, ...campos });
    }
    return { oportunidade: op, etapa: et.rows[0], contato_id: contatoId, criou: !viva.rowCount };
  }, bancoDe(chave));
}

// ---- Serviços (agendamentos) e pagamentos com comprovante (migração 013) ----

const SITUACOES = ['agendado', 'confirmado', 'realizado', 'cancelado', 'faltou'];
const FORMAS = ['pix', 'cartao', 'boleto', 'dinheiro', 'outro'];
const MAX_ARQUIVO = 10 * 1024 * 1024;
// O tipo declarado tem que bater com o começo do arquivo (um PDF começa com %PDF etc.).
export const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const semTabela = (e: unknown) => (e as { code?: string }).code === '42P01';
function exigirTabelas(e: unknown): never {
  if (semTabela(e)) throw new ErroApi(503, 'Serviços e pagamentos ainda não foram instalados no banco desta empresa (migração 013).');
  throw e;
}

export const texto = (v: unknown, max: number) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };
function numero(v: unknown, campo: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new ErroApi(400, `${campo} inválido.`);
  return Math.round(n * 100) / 100;
}
export function quando(v: unknown, campo: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ErroApi(400, `${campo}: use data e hora ISO (ex.: 2026-10-14T15:00:00-03:00).`);
  return d.toISOString();
}

// Acha o contato pelo telefone (com e sem o 9) ou cria. Nome só preenche contato sem nome.
export async function contatoDoTelefone(c: PoolClient, chave: Chave, telefone: unknown, nome: string | null): Promise<string> {
  const tel = normalizarTelefone(telefone);
  const cont = await c.query(`select id, nome from contatos where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em limit 1`, chaveTelefone(tel));
  if (cont.rowCount) {
    if (nome && !cont.rows[0].nome) await c.query('update contatos set nome = $2, atualizado_em = now() where id = $1', [cont.rows[0].id, nome]);
    return cont.rows[0].id;
  }
  const novo = await c.query('insert into contatos (telefone, nome) values ($1, $2) returning id', [tel, nome]);
  await auditar(c, chave, 'criar', 'contatos', novo.rows[0].id, { telefone: tel, nome });
  return novo.rows[0].id;
}

async function contatoDoCorpo(c: PoolClient, chave: Chave, d: Record<string, unknown>): Promise<string> {
  if (d.contato_id !== undefined && d.contato_id !== null && d.contato_id !== '') {
    const id = String(d.contato_id);
    if (!UUID.test(id)) throw new ErroApi(400, 'contato_id inválido.');
    const r = await c.query('select 1 from contatos where id = $1', [id]);
    if (!r.rowCount) throw new ErroApi(400, 'Contato não encontrado.');
    return id;
  }
  if (d.telefone === undefined) throw new ErroApi(400, 'Informe "telefone" (ou "contato_id").');
  return contatoDoTelefone(c, chave, d.telefone, texto(d.nome, 120));
}

// Cria ou atualiza o agendamento pelo código do sistema da empresa (sistema + codigo_externo).
export async function registrarServico(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Envie um objeto JSON.');
  const d = corpo as Record<string, unknown>;
  const situacao = d.situacao === undefined ? undefined : String(d.situacao);
  if (situacao !== undefined && !SITUACOES.includes(situacao)) throw new ErroApi(400, `situacao: ${SITUACOES.join(' | ')}.`);
  const sistema = texto(d.sistema, 40)?.toLowerCase() ?? null;
  const codigo = texto(d.codigo_externo, 120);
  if (codigo && !sistema) throw new ErroApi(400, 'Com codigo_externo, informe também "sistema" (ex.: feegow).');
  const detalhes = d.detalhes === undefined ? undefined : d.detalhes;
  if (detalhes !== undefined && (typeof detalhes !== 'object' || Array.isArray(detalhes) || detalhes === null)) throw new ErroApi(400, 'detalhes precisa ser um objeto.');
  if (detalhes !== undefined && JSON.stringify(detalhes).length > 20000) throw new ErroApi(400, 'detalhes grande demais.');
  const atendimentoId = d.atendimento_id ? String(d.atendimento_id) : null;
  if (atendimentoId && !UUID.test(atendimentoId)) throw new ErroApi(400, 'atendimento_id inválido.');
  const campos: Record<string, unknown> = {};
  const por = (k: string, v: unknown) => { if (d[k] !== undefined) campos[k] = v; };
  por('tipo', texto(d.tipo, 60));
  por('descricao', texto(d.descricao, 500));
  por('inicio', quando(d.inicio, 'inicio'));
  por('profissional', texto(d.profissional, 120));
  por('local', texto(d.local, 120));
  por('valor', numero(d.valor, 'valor'));
  if (situacao !== undefined) campos.situacao = situacao;
  if (detalhes !== undefined) campos.detalhes = JSON.stringify(detalhes);
  if (atendimentoId) campos.atendimento_id = atendimentoId;
  try {
    return await transacao(async (c) => {
      const contatoId = await contatoDoCorpo(c, chave, d);
      const atual = codigo
        ? await c.query('select id, contato_id from servicos where sistema = $1 and codigo_externo = $2 for update', [sistema, codigo])
        : { rowCount: 0, rows: [] as { id: string; contato_id: string }[] };
      if (atual.rowCount) {
        const id = atual.rows[0].id as string;
        const cols = Object.keys(campos);
        // Registro que o espelho da agenda criou antes (lib/agenda/espelho.ts): passa a ser de quem registrou agora
        // (a Sara), e os detalhes se somam (os da Feegow ficam).
        const quem = texto(d.criado_por, 80) ?? (chave.usuario_id ? chave.nome : 'IA');
        await c.query(
          `update servicos set ${cols.map((k, i) => `${k} = ${k === 'detalhes' ? `coalesce(detalhes, '{}'::jsonb) || $${i + 3}::jsonb` : `$${i + 3}`}`).concat('').join(', ')}
             criado_por = case when criado_por = 'Feegow (espelho)' then $2 else criado_por end, arquivado = false, atualizado_em = now() where id = $1`,
          [id, quem, ...Object.values(campos)]);
        await auditar(c, chave, 'atualizar', 'servicos', id, { ...campos, detalhes: undefined, sistema, codigo_externo: codigo });
        return { id, criado: false, contato_id: atual.rows[0].contato_id };
      }
      if (!campos.tipo) throw new ErroApi(400, 'Informe "tipo" (ex.: Consulta).');
      const linha = {
        contato_id: contatoId, sistema, codigo_externo: codigo, criado_por: texto(d.criado_por, 80) ?? (chave.usuario_id ? chave.nome : 'IA'), ...campos,
      };
      const cols = Object.keys(linha);
      const res = await c.query(
        `insert into servicos (${cols.join(', ')}) values (${cols.map((k, i) => `$${i + 1}${k === 'detalhes' ? '::jsonb' : ''}`).join(', ')}) returning id`,
        Object.values(linha));
      await auditar(c, chave, 'criar', 'servicos', res.rows[0].id, { ...linha, detalhes: undefined });
      return { id: res.rows[0].id as string, criado: true, contato_id: contatoId };
    }, bancoDe(chave));
  } catch (e) { if (e instanceof ErroApi) throw e; if (semTabela(e)) exigirTabelas(e); traduzErroBanco(e); }
}

function lerArquivo(a: unknown): { nome: string; mime: string; dados: Buffer; sha256: string } | null {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) throw new ErroApi(400, 'arquivo: envie {nome, mime, base64}.');
  const x = a as Record<string, unknown>;
  const mime = String(x.mime ?? '').toLowerCase().split(';')[0].trim();
  if (!ASSINATURAS[mime]) throw new ErroApi(400, 'arquivo: aceito PDF, JPG, PNG ou WEBP.');
  const b64 = String(x.base64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new ErroApi(400, 'arquivo: base64 inválido.');
  if (b64.length > Math.ceil(MAX_ARQUIVO / 3) * 4 + 4) throw new ErroApi(413, 'arquivo: até 10 MB.');
  const dados = Buffer.from(b64, 'base64');
  if (!dados.length || dados.length > MAX_ARQUIVO) throw new ErroApi(413, 'arquivo: até 10 MB.');
  if (!ASSINATURAS[mime](dados)) throw new ErroApi(400, 'arquivo: o conteúdo não é do tipo informado.');
  const nome = (texto(x.nome, 120) ?? 'comprovante').replace(/[\\/\u0000-\u001f]/g, '_');
  return { nome, mime, dados, sha256: createHash('sha256').update(dados).digest('hex') };
}

function lerAnalise(a: unknown): { resultado: 'ok' | 'suspeito'; motivos: string[] } | null {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) throw new ErroApi(400, 'analise: envie {resultado, motivos}.');
  const x = a as Record<string, unknown>;
  if (x.resultado !== 'ok' && x.resultado !== 'suspeito') throw new ErroApi(400, 'analise.resultado: ok | suspeito.');
  const motivos = (Array.isArray(x.motivos) ? x.motivos : []).map((m) => texto(m, 300)).filter((m): m is string => Boolean(m)).slice(0, 10);
  return { resultado: x.resultado, motivos };
}

// O que está escrito no comprovante (migração 014). Nomes da API → colunas.
function lerComprovante(v: unknown): Record<string, string | null> | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ErroApi(400, 'comprovante: envie {pagador, banco, id_pix, recebedor, recebedor_documento, emitido_em}.');
  const x = v as Record<string, unknown>;
  const validos = ['pagador', 'banco', 'id_pix', 'recebedor', 'recebedor_documento', 'emitido_em'];
  const fora = Object.keys(x).filter((k) => !validos.includes(k));
  if (fora.length) throw new ErroApi(400, `comprovante: campos desconhecidos: ${fora.join(', ')}.`, { campos_validos: validos });
  const out: Record<string, string | null> = {};
  if ('pagador' in x) out.pagador = texto(x.pagador, 120);
  if ('banco' in x) out.banco = texto(x.banco, 80);
  if ('id_pix' in x) {
    const e = String(x.id_pix ?? '').replace(/\s+/g, '').toUpperCase();
    if (e && !/^[A-Z0-9]{20,40}$/.test(e)) throw new ErroApi(400, 'comprovante.id_pix: só letras e números (o ID Pix E2E tem 32).');
    out.pix_e2e = e || null;
  }
  if ('recebedor' in x) out.recebedor = texto(x.recebedor, 120);
  if ('recebedor_documento' in x) {
    const d = String(x.recebedor_documento ?? '').replace(/\D/g, '');
    if (d && d.length !== 11 && d.length !== 14) throw new ErroApi(400, 'comprovante.recebedor_documento: CNPJ (14 números) ou CPF (11).');
    out.recebedor_documento = d || null;
  }
  if ('emitido_em' in x) out.comprovante_em = quando(x.emitido_em, 'comprovante.emitido_em');
  return out;
}
const semColuna = (e: unknown) => (e as { code?: string }).code === '42703';
const falta014 = () => new ErroApi(503, 'Os campos do comprovante ainda não foram instalados no banco desta empresa (migração 014).');

const reais = (v: number | null) => (v === null ? '' : 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

// Comprovante suspeito: abre um cartão no quadro (assunto de valores), já marcado como alerta. Um por pagamento.
async function abrirAlerta(c: PoolClient, chave: Chave, pagamentoId: string) {
  const p = await c.query(
    `select contato_id, valor, descricao, analise, analise_motivos, alerta_atendimento_id from pagamentos where id = $1 for update`, [pagamentoId]);
  const x = p.rows[0];
  if (!x || x.analise !== 'suspeito' || x.alerta_atendimento_id) return null;
  const top = await c.query(
    `select id from crm_topicos where not arquivado order by (icone = 'valor') desc, (id = 'outros') desc, ordem limit 1`);
  const motivos = (x.analise_motivos as string[]).join('; ');
  const valor = x.valor === null ? null : Number(x.valor);
  const resumo = `Comprovante suspeito${valor !== null ? ' de ' + reais(valor) : ''}${x.descricao ? ` (${x.descricao})` : ''}${motivos ? ': ' + motivos : ''}. Confira antes de confirmar o pagamento.`.slice(0, 1000);
  const a = await c.query(
    `insert into atendimentos (contato_id, topico_id, etapa, resumo, aberto_por, alerta) values ($1, $2, 'aguardando', $3, 'IA (análise de comprovante)', true) returning id`,
    [x.contato_id, top.rows[0]?.id ?? null, resumo]);
  await c.query('update pagamentos set alerta_atendimento_id = $2 where id = $1', [pagamentoId, a.rows[0].id]);
  await auditar(c, chave, 'criar', 'atendimentos', a.rows[0].id, { alerta: 'comprovante_suspeito', pagamento_id: pagamentoId });
  return a.rows[0].id as string;
}

// O comprovante suspeito também entra na fila de avisos da Planee (Interno Planee), um por pagamento: a Planee
// confere se a análise da IA acertou. Depois do commit; nunca derruba o pedido. Sem dado do paciente no título.
async function avisarPlanee(chave: Chave, pagamentoId: string, atendimentoId: string) {
  const empresa = chave.empresa?.id ?? empresaDoBancoPadrao();
  if (!empresa) return;
  await avisoDoSistema(empresa, {
    tipo: 'comprovante_suspeito', chave: `comprovante:${empresa}:${pagamentoId}`,
    titulo: 'Comprovante suspeito: conferir a análise da IA e o cartão de valores',
    ref: { alvo: 'cartao', alvo_id: atendimentoId, pagamento_id: pagamentoId },
  });
}

// Comprovante reaproveitado: o mesmo ID Pix já está em outro pagamento de outro contato ou de outro agendamento.
// Marca o pagamento como suspeito (o motivo fica mesmo que a análise da IA venha depois dizendo "ok").
async function marcarPixRepetido(c: PoolClient, pagamentoId: string) {
  const r = await c.query(
    `select o.valor, o.contato_id <> p.contato_id as outro_contato
       from pagamentos p join pagamentos o on o.pix_e2e = p.pix_e2e and o.id <> p.id and not o.arquivado
      where p.id = $1 and p.pix_e2e is not null and (o.contato_id <> p.contato_id or o.servico_id is distinct from p.servico_id)
      order by o.criado_em limit 1`, [pagamentoId]);
  if (!r.rowCount) return false;
  const o = r.rows[0];
  const valor = o.valor === null ? '' : ` (${reais(Number(o.valor))})`;
  const motivo = `ID Pix repetido: este comprovante já foi usado em outro pagamento${valor}, ${o.outro_contato ? 'de outro contato' : 'de outro agendamento'}.`;
  await c.query(
    `update pagamentos set analise = 'suspeito', analisado_em = coalesce(analisado_em, now()),
            analise_motivos = case when analise_motivos @> jsonb_build_array($2::text) then analise_motivos else analise_motivos || jsonb_build_array($2::text) end
      where id = $1`, [pagamentoId, motivo]);
  return true;
}

async function servicoDoCorpo(c: PoolClient, d: Record<string, unknown>, contatoId: string): Promise<string | null> {
  if (d.servico_id) {
    const id = String(d.servico_id);
    if (!UUID.test(id)) throw new ErroApi(400, 'servico_id inválido.');
    const r = await c.query('select contato_id from servicos where id = $1', [id]);
    if (!r.rowCount) throw new ErroApi(400, 'Serviço não encontrado.');
    if (r.rows[0].contato_id !== contatoId) throw new ErroApi(400, 'Esse serviço é de outro contato.');
    return id;
  }
  if (d.servico && typeof d.servico === 'object') {
    const s = d.servico as Record<string, unknown>;
    const sistema = texto(s.sistema, 40)?.toLowerCase(); const codigo = texto(s.codigo_externo, 120);
    if (!sistema || !codigo) throw new ErroApi(400, 'servico: envie {sistema, codigo_externo}.');
    const r = await c.query('select id, contato_id from servicos where sistema = $1 and codigo_externo = $2', [sistema, codigo]);
    if (!r.rowCount) throw new ErroApi(400, `Serviço ${sistema} ${codigo} não registrado. Registre antes em POST /api/v1/servicos/registrar.`);
    if (r.rows[0].contato_id !== contatoId) throw new ErroApi(400, 'Esse serviço é de outro contato.');
    return r.rows[0].id;
  }
  return null;
}

// Comprovante novo: contato (telefone ou id), serviço opcional, arquivo opcional, análise opcional,
// dados do comprovante opcionais. O mesmo comprovante chegando de novo (mesma mensagem do WhatsApp, ou o mesmo
// ID Pix para o mesmo contato e agendamento) não vira outro pagamento: devolve o que já existe, com "repetido": true.
export async function criarPagamento(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Envie um objeto JSON.');
  const d = corpo as Record<string, unknown>;
  const forma = d.forma === undefined || d.forma === null || d.forma === '' ? null : String(d.forma);
  if (forma !== null && !FORMAS.includes(forma)) throw new ErroApi(400, `forma: ${FORMAS.join(' | ')}.`);
  const atendimentoId = d.atendimento_id ? String(d.atendimento_id) : null;
  if (atendimentoId && !UUID.test(atendimentoId)) throw new ErroApi(400, 'atendimento_id inválido.');
  const arq = lerArquivo(d.arquivo);
  const analise = lerAnalise(d.analise);
  const comp = lerComprovante(d.comprovante);
  const valor = numero(d.valor, 'valor');
  const pagoEm = quando(d.pago_em, 'pago_em');
  const wamid = texto(d.wamid, 200);
  const e2e = comp?.pix_e2e ?? null;
  try {
    return await transacao(async (c) => {
      const contatoId = await contatoDoCorpo(c, chave, d);
      const servicoId = await servicoDoCorpo(c, d, contatoId);
      if (wamid || e2e) {
        const conds: string[] = []; const vals: unknown[] = [contatoId];
        if (wamid) { vals.push(wamid); conds.push(`wamid = $${vals.length}`); }
        if (e2e) { vals.push(e2e, servicoId); conds.push(`(pix_e2e = $${vals.length - 1} and servico_id is not distinct from $${vals.length}::uuid)`); }
        const rep = await c.query(
          `select id, alerta_atendimento_id, arquivo_nome is not null as tem_arquivo from pagamentos
            where not arquivado and contato_id = $1 and (${conds.join(' or ')})
            order by criado_em limit 1 for update`, vals);
        if (rep.rowCount) {
          const x = rep.rows[0];
          if (arq && !x.tem_arquivo) {
            await c.query(`update pagamentos set arquivo_nome = $2, arquivo_mime = $3, arquivo_tamanho = $4, arquivo_sha256 = $5, atualizado_em = now() where id = $1`,
              [x.id, arq.nome, arq.mime, arq.dados.length, arq.sha256]);
            await c.query('insert into pagamentos_arquivos (pagamento_id, dados) values ($1, $2) on conflict (pagamento_id) do nothing', [x.id, arq.dados]);
            await auditar(c, chave, 'atualizar', 'pagamentos', x.id, { arquivo: { mime: arq.mime, tamanho: arq.dados.length, sha256: arq.sha256 }, repetido: true });
          }
          return { id: x.id as string, contato_id: contatoId, servico_id: servicoId, alerta_atendimento_id: (x.alerta_atendimento_id as string) ?? null, repetido: true, novoAlerta: false };
        }
      }
      const linha: Record<string, unknown> = {
        contato_id: contatoId, servico_id: servicoId, atendimento_id: atendimentoId, valor, pago_em: pagoEm, forma,
        descricao: texto(d.descricao, 300), wamid,
        arquivo_nome: arq?.nome ?? null, arquivo_mime: arq?.mime ?? null, arquivo_tamanho: arq?.dados.length ?? null, arquivo_sha256: arq?.sha256 ?? null,
        analise: analise?.resultado ?? null, analise_motivos: JSON.stringify(analise?.motivos ?? []),
        criado_por: texto(d.criado_por, 80) ?? (chave.usuario_id ? chave.nome : 'IA'),
        ...(comp ?? {}),
      };
      const cols = Object.keys(linha);
      const res = await c.query(
        `insert into pagamentos (${cols.join(', ')}, analisado_em)
         values (${cols.map((k, i) => `$${i + 1}${k === 'analise_motivos' ? '::jsonb' : ''}`).join(', ')}, ${analise ? 'now()' : 'null'}) returning id`,
        Object.values(linha));
      const id = res.rows[0].id as string;
      if (arq) await c.query('insert into pagamentos_arquivos (pagamento_id, dados) values ($1, $2)', [id, arq.dados]);
      await auditar(c, chave, 'criar', 'pagamentos', id, {
        contato_id: contatoId, servico_id: servicoId, valor, pago_em: pagoEm, forma, arquivo: arq ? { mime: arq.mime, tamanho: arq.dados.length, sha256: arq.sha256 } : null,
        analise: analise?.resultado ?? null, pix_e2e: e2e,
      });
      if (e2e) await marcarPixRepetido(c, id);
      const alerta = await abrirAlerta(c, chave, id);
      return { id, contato_id: contatoId, servico_id: servicoId, alerta_atendimento_id: alerta, novoAlerta: Boolean(alerta) };
    }, bancoDe(chave)).then(async ({ novoAlerta, ...r }) => {
      if (novoAlerta && r.alerta_atendimento_id) await avisarPlanee(chave, r.id, r.alerta_atendimento_id);
      // Sem arquivo: tenta copiar a foto ou o PDF que o paciente mandou pelo WhatsApp (lib/api/comprovante-whatsapp.ts).
      if (!arq) return { ...r, arquivo_do_whatsapp: await tentarArquivoDoWhatsApp(chave, r.id) };
      return r;
    });
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    if (semTabela(e)) exigirTabelas(e);
    if (semColuna(e) && comp) throw falta014();
    traduzErroBanco(e);
  }
}

// Atualiza valor, data, forma, descrição, serviço ou a análise. A análise "suspeito" abre o alerta (uma vez).
export async function atualizarPagamento(chave: Chave, id: string, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  if (!UUID.test(id)) throw new ErroApi(400, 'id inválido: esperado uuid.');
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Envie um objeto JSON.');
  const d = corpo as Record<string, unknown>;
  const permitidos = ['valor', 'pago_em', 'forma', 'descricao', 'servico_id', 'servico', 'atendimento_id', 'analise', 'wamid', 'comprovante'];
  const fora = Object.keys(d).filter((k) => !permitidos.includes(k));
  if (fora.length) throw new ErroApi(400, `Campos que não podem ser mudados em pagamentos: ${fora.join(', ')}.`, { campos_validos: permitidos });
  const campos: Record<string, unknown> = {};
  if ('valor' in d) campos.valor = numero(d.valor, 'valor');
  if ('pago_em' in d) campos.pago_em = quando(d.pago_em, 'pago_em');
  if ('forma' in d) { const f = d.forma ? String(d.forma) : null; if (f !== null && !FORMAS.includes(f)) throw new ErroApi(400, `forma: ${FORMAS.join(' | ')}.`); campos.forma = f; }
  if ('descricao' in d) campos.descricao = texto(d.descricao, 300);
  if ('wamid' in d) campos.wamid = texto(d.wamid, 200);
  if ('atendimento_id' in d) { const a = d.atendimento_id ? String(d.atendimento_id) : null; if (a && !UUID.test(a)) throw new ErroApi(400, 'atendimento_id inválido.'); campos.atendimento_id = a; }
  const analise = 'analise' in d ? lerAnalise(d.analise) : undefined;
  const comp = lerComprovante(d.comprovante);
  if (comp) Object.assign(campos, comp);
  try {
    return await transacao(async (c) => {
      const atual = await c.query('select contato_id from pagamentos where id = $1 for update', [id]);
      if (!atual.rowCount) throw new ErroApi(404, `pagamentos/${id} não encontrado.`);
      if ('servico_id' in d || 'servico' in d) campos.servico_id = await servicoDoCorpo(c, d, atual.rows[0].contato_id);
      const sets: string[] = []; const vals: unknown[] = [id];
      for (const [k, v] of Object.entries(campos)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
      if (analise !== undefined) {
        vals.push(analise?.resultado ?? null); sets.push(`analise = $${vals.length}`);
        vals.push(JSON.stringify(analise?.motivos ?? [])); sets.push(`analise_motivos = $${vals.length}::jsonb`);
        sets.push('analisado_em = now()');
      }
      if (!sets.length) throw new ErroApi(400, 'Nenhum campo para atualizar.');
      await c.query(`update pagamentos set ${sets.join(', ')}, atualizado_em = now() where id = $1`, vals);
      await auditar(c, chave, 'atualizar', 'pagamentos', id, { ...campos, ...(analise !== undefined ? { analise: analise?.resultado ?? null, motivos: analise?.motivos ?? [] } : {}) });
      // A análise nova substitui a anterior, mas o ID Pix repetido continua valendo (precisa da 014).
      if (comp) await marcarPixRepetido(c, id);
      else if (analise !== undefined || 'servico_id' in campos) {
        // Banco ainda sem a 014: a checagem não roda, e a transação segue (savepoint).
        await c.query('savepoint pix');
        try { await marcarPixRepetido(c, id); await c.query('release savepoint pix'); }
        catch (e) { await c.query('rollback to savepoint pix'); if (!semColuna(e)) throw e; }
      }
      const alerta = await abrirAlerta(c, chave, id);
      const r = await c.query(`select id, contato_id, servico_id, valor, pago_em, forma, descricao, analise, analise_motivos, alerta_atendimento_id, conferido_em, conferido_por
                                 from pagamentos where id = $1`, [id]);
      return { ...r.rows[0], valor: r.rows[0].valor === null ? null : Number(r.rows[0].valor), alerta_aberto: alerta };
    }, bancoDe(chave)).then(async (r) => {
      if (r.alerta_aberto) await avisarPlanee(chave, id, r.alerta_aberto);
      return r;
    });
  } catch (e) { if (e instanceof ErroApi) throw e; if (semTabela(e)) exigirTabelas(e); if (semColuna(e) && comp) throw falta014(); traduzErroBanco(e); }
}

export async function arquivoDoPagamento(chave: Chave, id: string): Promise<{ nome: string; mime: string; dados: Buffer }> {
  exigirEscopo(chave, 'leitura');
  if (!UUID.test(id)) throw new ErroApi(400, 'id inválido: esperado uuid.');
  try {
    const r = await bancoDe(chave).query(
      `select p.arquivo_nome, p.arquivo_mime, a.dados from pagamentos p join pagamentos_arquivos a on a.pagamento_id = p.id where p.id = $1`, [id]);
    if (!r.rowCount) throw new ErroApi(404, 'Esse pagamento não tem arquivo.');
    return { nome: r.rows[0].arquivo_nome, mime: r.rows[0].arquivo_mime, dados: r.rows[0].dados };
  } catch (e) { if (e instanceof ErroApi) throw e; exigirTabelas(e); }
}

// Conferido pela equipe: só pessoa (painel), nunca chave de IA.
export async function conferirPagamento(chave: Chave, id: string, conferido: boolean) {
  exigirEscopo(chave, 'crm');
  if (!chave.usuario_id) throw new ErroApi(403, 'Só uma pessoa da equipe confere o comprovante.');
  if (!UUID.test(id)) throw new ErroApi(400, 'id inválido.');
  try {
    return await transacao(async (c) => {
      const r = await c.query(
        `update pagamentos set conferido_em = case when $2 then now() end, conferido_por = case when $2 then $3 end, atualizado_em = now()
          where id = $1 and not arquivado returning id`, [id, conferido, chave.nome]);
      if (!r.rowCount) throw new ErroApi(404, 'Pagamento não encontrado.');
      await auditar(c, chave, 'atualizar', 'pagamentos', id, { conferido });
      return true;
    }, bancoDe(chave));
  } catch (e) { if (e instanceof ErroApi) throw e; exigirTabelas(e); }
}
