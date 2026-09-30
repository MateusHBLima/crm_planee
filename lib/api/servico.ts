import 'server-only';
import type { PoolClient } from 'pg';
import { transacao, ErroApi } from '@/lib/db';
import { recurso as acharRecurso, type Recurso } from './recursos';
import { bancoDe, type Chave } from './auth';
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

function exigirEscopo(chave: Chave, escopo: string) {
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

async function auditar(c: PoolClient, chave: Chave, acao: string, recurso: string, alvo: string | null, detalhe: unknown) {
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
    return { itens: res.rows, limite: lim, deslocamento: off };
  } catch (e) { traduzErroBanco(e); }
}

export async function obter(chave: Chave, nome: string, id: string) {
  exigirEscopo(chave, 'leitura');
  const r = exigirRecurso(nome);
  validarId(r, id);
  const res = await bancoDe(chave).query(`select * from ${r.tabela} where id = $1`, [id]);
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
    }, bancoDe(chave));
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
    return res.rows[0];
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
  if (!cont.rowCount) return { encontrado: false, telefone: tel, contatos: [], etapas_funil: etapas.rows };
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
  return {
    encontrado: true,
    telefone: tel,
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
