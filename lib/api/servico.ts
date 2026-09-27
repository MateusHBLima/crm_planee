import 'server-only';
import type { PoolClient } from 'pg';
import { banco, transacao, ErroApi } from '@/lib/db';
import { recurso as acharRecurso, type Recurso } from './recursos';
import type { Chave } from './auth';

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

function exigirEscopo(chave: Chave, escopo: string) {
  if (!chave.escopos.includes(escopo)) throw new ErroApi(403, `Esta chave não tem o escopo "${escopo}".`);
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

async function auditar(c: PoolClient, chave: Chave, acao: string, recurso: string, alvo: string | null, detalhe: unknown) {
  await c.query(
    'insert into painel_auditoria (chave_id, acao, recurso, alvo_id, detalhe) values ($1,$2,$3,$4,$5)',
    [chave.id, acao, recurso, alvo, detalhe === undefined ? null : JSON.stringify(detalhe)],
  );
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
    const res = await banco().query(sql, vals);
    return { itens: res.rows, limite: lim, deslocamento: off };
  } catch (e) { traduzErroBanco(e); }
}

export async function obter(chave: Chave, nome: string, id: string) {
  exigirEscopo(chave, 'leitura');
  const r = exigirRecurso(nome);
  validarId(r, id);
  const res = await banco().query(`select * from ${r.tabela} where id = $1`, [id]);
  if (!res.rowCount) throw new ErroApi(404, `${r.nome}/${id} não encontrado.`);
  return res.rows[0];
}

export async function criar(chave: Chave, nome: string, corpo: unknown) {
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
      return res.rows[0];
    });
  } catch (e) { if (e instanceof ErroApi) throw e; traduzErroBanco(e); }
}

export async function atualizar(chave: Chave, nome: string, id: string, corpo: unknown) {
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
      return res.rows[0];
    });
  } catch (e) { if (e instanceof ErroApi) throw e; traduzErroBanco(e); }
}

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
    return res.rows[0];
  });
}

export async function lerConfig(chave: Chave, nomeChave?: string) {
  exigirEscopo(chave, 'leitura');
  if (nomeChave) {
    const res = await banco().query('select chave, valor, atualizado_em from crm_config where chave = $1', [nomeChave]);
    if (!res.rowCount) throw new ErroApi(404, `Configuração "${nomeChave}" não existe.`);
    return res.rows[0];
  }
  const res = await banco().query('select chave, valor, atualizado_em from crm_config order by chave');
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
  });
}
