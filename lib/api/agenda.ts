import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { ErroApi, transacao } from '@/lib/db';
import { exigirLigada } from './agenda-ligada';
export { agendaLigada } from './agenda-ligada';
import { bancoDe, type Chave } from './auth';
import { auditar, contatoDoCorpo, exigirEscopo, quando, texto } from './servico';

// Agenda própria (migração 035, 23/11). Cadastro (profissionais, tipos, salas, grade, bloqueios) pelos recursos
// genéricos (lib/api/recursos.ts). Aqui ficam os horários livres e os agendamentos, usados pela IA (n8n), pelas telas
// e pelo link público:
//   GET  /api/v1/agenda                         profissionais, tipos e salas ativos
//   GET  /api/v1/agenda/horarios?tipo&profissional?&de&ate   horários livres (de/ate = datas locais AAAA-MM-DD)
//   GET  /api/v1/agenda/agendamentos?de&ate&profissional&telefone&contato_id&status
//   POST /api/v1/agenda/agendamentos            {tipo, profissional?, inicio, telefone|contato_id, nome?, origem?, observacao?, chave?}
//   PATCH /api/v1/agenda/agendamentos/{id}      {inicio?, profissional?, status?, observacao?}   (remarcar / status)
//   POST /api/v1/agenda/agendamentos/{id}/cancelar {motivo?}
// Cada agendamento vira também um serviço (servicos, sistema 'agenda'): aparece na ficha, na Inbox e nos comprovantes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = ['agendado', 'confirmado', 'atendido', 'faltou', 'cancelado'] as const;
const ORIGENS = ['IA', 'painel', 'link', 'google', 'api'];
const SITUACAO_SERVICO: Record<string, string> = { agendado: 'agendado', confirmado: 'confirmado', atendido: 'realizado', faltou: 'faltou', cancelado: 'cancelado' };
const MAX_DIAS = 62;

const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const falta035 = () => new ErroApi(503, 'A agenda própria ainda não foi instalada no banco desta empresa (migração 035).');
const objeto = (corpo: unknown) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Envie um objeto JSON.');
  return corpo as Record<string, unknown>;
};
const uuid = (v: unknown, campo: string) => { const s = String(v ?? ''); if (!UUID.test(s)) throw new ErroApi(400, `${campo}: id inválido.`); return s; };
const uuidOpc = (v: unknown, campo: string) => (v === undefined || v === null || v === '' ? null : uuid(v, campo));

export type ConfigAgenda = { fuso: string; antecedencia_min: number; limite_dias: number; passo_min: number | null };
export async function configAgenda(db: Pool | PoolClient): Promise<ConfigAgenda> {
  const r = await db.query(`select valor from crm_config where chave = 'agenda'`).catch(() => ({ rows: [] as { valor?: unknown }[] }));
  const v = (r.rows[0]?.valor ?? {}) as Record<string, unknown>;
  const n = (x: unknown, padrao: number, min: number, max: number) => { const k = Number(x); return Number.isFinite(k) && k >= min && k <= max ? Math.round(k) : padrao; };
  const fuso = typeof v.fuso === 'string' && /^[A-Za-z_]+\/[A-Za-z_\/]+$/.test(v.fuso) ? v.fuso : (process.env.PAINEL_FUSO || 'America/Sao_Paulo');
  return {
    fuso, antecedencia_min: n(v.antecedencia_min, 60, 0, 60 * 24 * 30), limite_dias: n(v.limite_dias, 60, 1, 365),
    passo_min: v.passo_min === undefined || v.passo_min === null ? null : n(v.passo_min, 30, 5, 240),
  };
}

// A agenda própria só responde na empresa que a tem ligada (permissão agenda.ver em empresas.modulos, tela Empresas).
// Pelo endereço geral do painel (sem domínio de empresa) vale a empresa do banco padrão.
async function comBanco<T>(chave: Chave, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await exigirLigada(chave);
  try { return await transacao(fn, bancoDe(chave)); } catch (e) { if (semTabela(e)) throw falta035(); throw e; }
}
async function ler<T>(db: Pool, fn: () => Promise<T>, chave?: Chave): Promise<T> {
  if (chave) await exigirLigada(chave);
  try { return await fn(); } catch (e) { if (semTabela(e)) throw falta035(); throw e; }
}

export async function resumoAgenda(chave: Chave) {
  exigirEscopo(chave, 'leitura');
  const db = bancoDe(chave);
  return ler(db, async () => {
    const [p, t, s, cfg] = await Promise.all([
      db.query('select id, nome, descricao, cor from ag_profissionais where not arquivado order by ordem, nome'),
      db.query('select id, nome, duracao_min, valor, cor, modalidade, descricao, profissionais, publico from ag_tipos where not arquivado order by ordem, nome'),
      db.query('select id, nome from ag_salas where not arquivado order by nome'),
      configAgenda(db),
    ]);
    return {
      profissionais: p.rows, salas: s.rows, fuso: cfg.fuso,
      tipos: t.rows.map((x) => ({ ...x, valor: x.valor === null ? null : Number(x.valor) })),
    };
  }, chave);
}

// ---- Horários livres ----

export type Horario = { profissional_id: string; profissional: string; inicio: string; fim: string };

// Slots da grade (passo = duração do tipo, ou crm_config agenda.passo_min) que não batem com agendamento ativo nem
// bloqueio, a partir de agora + antecedência e até o limite de dias. de/ate: datas locais da empresa.
export async function horariosLivres(db: Pool | PoolClient, p: { tipo: string; profissional?: string | null; de: string; ate: string }): Promise<Horario[]> {
  const cfg = await configAgenda(db);
  const t = await db.query('select duracao_min, profissionais from ag_tipos where id = $1 and not arquivado', [p.tipo]);
  if (!t.rowCount) throw new ErroApi(404, 'Tipo de atendimento não encontrado.');
  const dur = Number(t.rows[0].duracao_min);
  const passo = cfg.passo_min ?? dur;
  const quem: string[] = t.rows[0].profissionais ?? [];
  const r = await db.query(
    `with dias as (select d::date as dia from generate_series($1::date, $2::date, interval '1 day') d),
     janelas as (
       select g.profissional_id, (dias.dia + g.inicio) at time zone $3 as ini, (dias.dia + g.fim) at time zone $3 as fim
         from ag_grade g join dias on extract(dow from dias.dia) = g.dia_semana
         join ag_profissionais pr on pr.id = g.profissional_id and not pr.arquivado
        where not g.arquivado and ($4::uuid is null or g.profissional_id = $4)
          and (cardinality($5::uuid[]) = 0 or g.profissional_id = any($5))),
     slots as (
       select j.profissional_id, s as ini, s + make_interval(mins => $6) as fim
         from janelas j, generate_series(j.ini, j.fim - make_interval(mins => $6), make_interval(mins => $7)) s)
     select distinct s.profissional_id, pr.nome, s.ini, s.fim from slots s join ag_profissionais pr on pr.id = s.profissional_id
      where s.ini >= now() + make_interval(mins => $8) and s.ini < now() + make_interval(days => $9)
        and not exists (select 1 from ag_agendamentos a where a.profissional_id = s.profissional_id and a.status <> 'cancelado'
                          and not a.arquivado and a.inicio < s.fim and a.fim > s.ini)
        and not exists (select 1 from ag_bloqueios b where not b.arquivado and (b.profissional_id is null or b.profissional_id = s.profissional_id)
                          and b.inicio < s.fim and b.fim > s.ini)
      order by s.ini, pr.nome limit 400`,
    [p.de, p.ate, cfg.fuso, p.profissional ?? null, quem, dur, passo, cfg.antecedencia_min, cfg.limite_dias]);
  return r.rows.map((x) => ({ profissional_id: String(x.profissional_id), profissional: String(x.nome), inicio: new Date(x.ini).toISOString(), fim: new Date(x.fim).toISOString() }));
}

function intervalo(de: unknown, ate: unknown): { de: string; ate: string } {
  const hoje = new Date().toISOString().slice(0, 10);
  const d = de ? String(de) : hoje;
  const a = ate ? String(ate) : d;
  if (!DATA.test(d) || !DATA.test(a)) throw new ErroApi(400, 'de e ate: datas no formato AAAA-MM-DD.');
  const dias = (Date.parse(a) - Date.parse(d)) / 86400000;
  if (dias < 0) throw new ErroApi(400, 'ate precisa ser depois de de.');
  if (dias > MAX_DIAS) throw new ErroApi(400, `Peça no máximo ${MAX_DIAS} dias por vez.`);
  return { de: d, ate: a };
}

export async function listarHorarios(chave: Chave, q: URLSearchParams) {
  exigirEscopo(chave, 'leitura');
  const tipo = uuid(q.get('tipo'), 'tipo');
  const prof = uuidOpc(q.get('profissional'), 'profissional');
  const { de, ate } = intervalo(q.get('de'), q.get('ate'));
  const db = bancoDe(chave);
  return ler(db, async () => ({ fuso: (await configAgenda(db)).fuso, horarios: await horariosLivres(db, { tipo, profissional: prof, de, ate }) }), chave);
}

// ---- Agendamentos ----

const SELECT = `select a.*, p.nome as profissional, t.nome as tipo, t.cor as tipo_cor, s.nome as sala, c.nome as contato_nome, c.telefone as contato_telefone
  from ag_agendamentos a join ag_profissionais p on p.id = a.profissional_id join ag_tipos t on t.id = a.tipo_id
  left join ag_salas s on s.id = a.sala_id left join contatos c on c.id = a.contato_id`;
export type Agendamento = {
  id: string; profissional_id: string; profissional: string; tipo_id: string; tipo: string; tipo_cor: string | null; sala: string | null;
  contato_id: string | null; nome: string | null; telefone: string | null; inicio: string; fim: string; status: string; origem: string;
  observacao: string | null; valor: number | null; criado_por: string | null; cancelado_motivo: string | null;
};
export const agendamentoDe = (x: Record<string, unknown>): Agendamento => ({
  id: String(x.id), profissional_id: String(x.profissional_id), profissional: String(x.profissional), tipo_id: String(x.tipo_id), tipo: String(x.tipo),
  tipo_cor: (x.tipo_cor as string) ?? null, sala: (x.sala as string) ?? null, contato_id: (x.contato_id as string) ?? null,
  nome: (x.nome as string) ?? (x.contato_nome as string) ?? null, telefone: (x.telefone as string) ?? (x.contato_telefone as string) ?? null,
  inicio: new Date(x.inicio as string).toISOString(), fim: new Date(x.fim as string).toISOString(), status: String(x.status), origem: String(x.origem),
  observacao: (x.observacao as string) ?? null, valor: x.valor === null || x.valor === undefined ? null : Number(x.valor),
  criado_por: (x.criado_por as string) ?? null, cancelado_motivo: (x.cancelado_motivo as string) ?? null,
});

export async function listarAgendamentos(chave: Chave, q: URLSearchParams) {
  exigirEscopo(chave, 'leitura');
  const db = bancoDe(chave);
  const cfg = await ler(db, () => configAgenda(db), chave);
  const { de, ate } = intervalo(q.get('de'), q.get('ate'));
  const prof = uuidOpc(q.get('profissional'), 'profissional');
  const contato = uuidOpc(q.get('contato_id'), 'contato_id');
  const tel = q.get('telefone') ? String(q.get('telefone')).replace(/\D/g, '').slice(-8) : null;
  const status = q.get('status');
  if (status && !(STATUS as readonly string[]).includes(status)) throw new ErroApi(400, `status: ${STATUS.join(', ')}.`);
  const r = await ler(db, () => db.query(
    `${SELECT} where not a.arquivado
        and a.inicio >= ($1::date)::timestamp at time zone $3 and a.inicio < ($2::date + 1)::timestamp at time zone $3
        and ($4::uuid is null or a.profissional_id = $4) and ($5::uuid is null or a.contato_id = $5)
        and ($6::text is null or right(regexp_replace(coalesce(a.telefone, c.telefone, ''), '\\D', '', 'g'), 8) = $6)
        and ($7::text is null or a.status = $7)
      order by a.inicio limit 500`, [de, ate, cfg.fuso, prof, contato, tel, status]));
  return { fuso: cfg.fuso, itens: r.rows.map(agendamentoDe) };
}

// Confere a vaga: dentro da grade do profissional (a não ser encaixe da equipe), sem agendamento ativo nem bloqueio
// no mesmo horário. Trava o profissional para dois pedidos ao mesmo tempo não pegarem a mesma vaga.
async function conferirVaga(c: PoolClient, p: { profissional: string; inicio: string; fim: string; ignorar?: string | null; encaixe: boolean; fuso: string }) {
  const pr = await c.query('select id from ag_profissionais where id = $1 and not arquivado for update', [p.profissional]);
  if (!pr.rowCount) throw new ErroApi(404, 'Profissional não encontrado.');
  if (!p.encaixe) {
    const g = await c.query(
      `select 1 from ag_grade g where g.profissional_id = $1 and not g.arquivado
          and g.dia_semana = extract(dow from ($2::timestamptz at time zone $4))
          and ($2::timestamptz at time zone $4)::time >= g.inicio and ($3::timestamptz at time zone $4)::time <= g.fim
          and ($2::timestamptz at time zone $4)::date = ($3::timestamptz at time zone $4)::date limit 1`,
      [p.profissional, p.inicio, p.fim, p.fuso]);
    if (!g.rowCount) throw new ErroApi(409, 'Fora da grade de atendimento deste profissional.', { codigo: 'fora_da_grade' });
  }
  const o = await c.query(
    `select 1 from ag_agendamentos where profissional_id = $1 and status <> 'cancelado' and not arquivado
        and inicio < $3 and fim > $2 and ($4::uuid is null or id <> $4) limit 1`, [p.profissional, p.inicio, p.fim, p.ignorar ?? null]);
  if (o.rowCount) throw new ErroApi(409, 'Horário já ocupado.', { codigo: 'ocupado' });
  const b = await c.query(
    `select motivo from ag_bloqueios where not arquivado and (profissional_id is null or profissional_id = $1) and inicio < $3 and fim > $2 limit 1`,
    [p.profissional, p.inicio, p.fim]);
  if (b.rowCount) throw new ErroApi(409, `Horário bloqueado${b.rows[0].motivo ? ` (${b.rows[0].motivo})` : ''}.`, { codigo: 'bloqueado' });
}

// O agendamento como serviço (ficha do contato, Inbox, comprovantes): cria ou atualiza pelo código da agenda.
async function espelharServico(c: PoolClient, id: string) {
  const r = await c.query(`${SELECT} where a.id = $1`, [id]);
  const a = r.rows[0];
  if (!a?.contato_id) return;
  const sala = a.sala ? ` · ${a.sala}` : '';
  await c.query(
    `insert into servicos (contato_id, tipo, inicio, profissional, local, valor, situacao, sistema, codigo_externo, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7, 'agenda', $8, $9)
     on conflict (sistema, codigo_externo) where codigo_externo is not null do update set
       contato_id = excluded.contato_id, tipo = excluded.tipo, inicio = excluded.inicio, profissional = excluded.profissional,
       local = excluded.local, valor = excluded.valor, situacao = excluded.situacao, arquivado = false, atualizado_em = now()`,
    [a.contato_id, a.tipo, a.inicio, a.profissional, a.sala ? `Agenda${sala}` : 'Agenda', a.valor, SITUACAO_SERVICO[a.status] ?? 'agendado', id, a.criado_por]);
}

export async function criarAgendamento(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = objeto(corpo);
  const tipo = uuid(d.tipo ?? d.tipo_id, 'tipo');
  const inicio = quando(d.inicio, 'inicio');
  if (!inicio) throw new ErroApi(400, 'Informe "inicio" (data e hora ISO).');
  const origem = d.origem === undefined ? (chave.usuario_id ? 'painel' : 'api') : String(d.origem);
  if (!ORIGENS.includes(origem)) throw new ErroApi(400, `origem: ${ORIGENS.join(', ')}.`);
  const encaixe = Boolean(d.encaixe) && Boolean(chave.usuario_id); // só a equipe, pela tela, marca fora da grade
  const chaveIdem = texto(d.chave, 200);
  return comBanco(chave, async (c) => {
    if (chaveIdem) {
      const ja = await c.query(`${SELECT} where a.chave = $1`, [chaveIdem]);
      if (ja.rowCount) return { ...agendamentoDe(ja.rows[0]), repetido: true };
    }
    const cfg = await configAgenda(c);
    const t = await c.query('select duracao_min, valor, profissionais from ag_tipos where id = $1 and not arquivado', [tipo]);
    if (!t.rowCount) throw new ErroApi(404, 'Tipo de atendimento não encontrado.');
    const fim = new Date(Date.parse(inicio) + Number(t.rows[0].duracao_min) * 60000).toISOString();
    let prof = uuidOpc(d.profissional ?? d.profissional_id, 'profissional');
    const quem: string[] = t.rows[0].profissionais ?? [];
    if (!prof) {
      // Sem profissional: o primeiro com a vaga livre (na ordem da lista).
      const dia = (ms: number) => new Date(Date.parse(inicio) + ms).toISOString().slice(0, 10);
      const livres = await horariosLivres(c, { tipo, de: dia(-86400000), ate: dia(86400000) });
      prof = livres.find((h) => h.inicio === new Date(inicio).toISOString())?.profissional_id ?? null;
      if (!prof) throw new ErroApi(409, 'Nenhum profissional livre neste horário.', { codigo: 'ocupado' });
    }
    if (quem.length && !quem.includes(prof)) throw new ErroApi(409, 'Este profissional não atende este tipo de atendimento.');
    if (!encaixe && Date.parse(inicio) < Date.now()) throw new ErroApi(409, 'Esse horário já passou.');
    await conferirVaga(c, { profissional: prof, inicio, fim, encaixe, fuso: cfg.fuso });
    const contatoId = d.contato_id || d.telefone ? await contatoDoCorpo(c, chave, d) : null;
    const quemCriou = texto(d.criado_por, 80) ?? (chave.usuario_id ? chave.nome : origem === 'IA' ? 'IA' : chave.nome);
    const ins = await c.query(
      `insert into ag_agendamentos (profissional_id, tipo_id, sala_id, contato_id, nome, telefone, inicio, fim, origem, observacao, valor, criado_por, chave)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [prof, tipo, uuidOpc(d.sala ?? d.sala_id, 'sala'), contatoId, texto(d.nome, 120), d.telefone ? String(d.telefone).replace(/\D/g, '').slice(0, 15) : null,
        inicio, fim, origem, texto(d.observacao, 1000), t.rows[0].valor, quemCriou, chaveIdem]);
    const id = String(ins.rows[0].id);
    await espelharServico(c, id);
    await auditar(c, chave, 'criar', 'agenda_agendamentos', id, { profissional: prof, tipo, inicio, origem });
    const r = await c.query(`${SELECT} where a.id = $1`, [id]);
    return { ...agendamentoDe(r.rows[0]), repetido: false };
  });
}

export async function alterarAgendamento(chave: Chave, id: string, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  uuid(id, 'id');
  const d = objeto(corpo);
  const status = d.status === undefined ? null : String(d.status);
  if (status && !(STATUS as readonly string[]).includes(status)) throw new ErroApi(400, `status: ${STATUS.join(', ')}.`);
  const novoInicio = quando(d.inicio, 'inicio');
  const novoProf = uuidOpc(d.profissional ?? d.profissional_id, 'profissional');
  const encaixe = Boolean(d.encaixe) && Boolean(chave.usuario_id);
  return comBanco(chave, async (c) => {
    const a = await c.query('select * from ag_agendamentos where id = $1 and not arquivado for update', [id]);
    if (!a.rowCount) throw new ErroApi(404, 'Agendamento não encontrado.');
    const atual = a.rows[0];
    if (atual.status === 'cancelado' && (novoInicio || novoProf)) throw new ErroApi(409, 'Agendamento cancelado: marque um novo.');
    const sets: string[] = []; const vals: unknown[] = [id];
    const por = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (novoInicio || novoProf) {
      const cfg = await configAgenda(c);
      const dur = Date.parse(atual.fim) - Date.parse(atual.inicio);
      const ini = novoInicio ?? new Date(atual.inicio).toISOString();
      const fim = new Date(Date.parse(ini) + dur).toISOString();
      const prof = novoProf ?? String(atual.profissional_id);
      if (!encaixe && Date.parse(ini) < Date.now()) throw new ErroApi(409, 'Esse horário já passou.');
      await conferirVaga(c, { profissional: prof, inicio: ini, fim, ignorar: id, encaixe, fuso: cfg.fuso });
      por('inicio', ini); por('fim', fim); por('profissional_id', prof);
    }
    if (status) {
      por('status', status);
      if (status === 'cancelado') { sets.push('cancelado_em = now()'); por('cancelado_motivo', texto(d.motivo, 300)); }
    }
    if (d.observacao !== undefined) por('observacao', texto(d.observacao, 1000));
    if (!sets.length) throw new ErroApi(400, 'Nada para mudar: envie inicio, profissional, status ou observacao.');
    await c.query(`update ag_agendamentos set ${sets.join(', ')}, atualizado_em = now() where id = $1`, vals);
    await espelharServico(c, id);
    await auditar(c, chave, novoInicio || novoProf ? 'remarcar' : 'atualizar', 'agenda_agendamentos', id, { inicio: novoInicio, profissional: novoProf, status });
    const r = await c.query(`${SELECT} where a.id = $1`, [id]);
    return agendamentoDe(r.rows[0]);
  });
}

export const cancelarAgendamento = (chave: Chave, id: string, corpo: unknown) =>
  alterarAgendamento(chave, id, { status: 'cancelado', motivo: (corpo as Record<string, unknown> | null)?.motivo });
