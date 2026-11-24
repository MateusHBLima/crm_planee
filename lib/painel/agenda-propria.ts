import 'server-only';
import { bancoDaEmpresa, ErroApi } from '@/lib/db';
import { pode, type Usuario } from '@/lib/sessao';
import type { Chave } from '@/lib/api/auth';
import * as ag from '@/lib/api/agenda';
import { auditar as auditarApi } from '@/lib/api/servico';
import { transacao } from '@/lib/db';

// Tela da agenda própria (migração 035, 23/11): semana ou dia por profissional, marcar, remarcar, status e cancelar,
// e a configuração (profissionais, tipos, grade, bloqueios). As regras de vaga ficam em lib/api/agenda.ts (as mesmas
// da IA); aqui só confere a permissão de quem está na tela.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');

function db(u: Usuario, p: 'agenda.ver' | 'agenda.editar' | 'agenda.config' = 'agenda.ver') {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir a agenda.');
  if (!pode(u, p)) throw new ErroApi(403, p === 'agenda.ver' ? 'Você não tem acesso à agenda nesta empresa.' : 'Sua conta não pode fazer isso na agenda.');
  return bancoDaEmpresa(u.empresa);
}
// Quem está na tela, como "chave" da API (as mesmas regras da IA), com o que a pessoa pode na agenda.
function ator(u: Usuario): Chave {
  const escopos = ['leitura'];
  if (pode(u, 'agenda.editar')) escopos.push('crm');
  if (pode(u, 'agenda.config')) escopos.push('config');
  return { id: null, nome: u.nome, escopos, usuario_id: u.id, empresa: u.empresa } as unknown as Chave;
}
async function consultar<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (semTabela(e)) throw new ErroApi(503, 'A agenda própria ainda não foi instalada no banco desta empresa (migração 035).');
    throw e;
  }
}

export type Profissional = { id: string; nome: string; descricao: string | null; cor: string | null; email: string | null; ordem: number };
export type Tipo = { id: string; nome: string; duracao_min: number; valor: number | null; cor: string | null; modalidade: string; descricao: string | null; profissionais: string[]; publico: boolean; ordem: number };
export type Janela = { id: string; profissional_id: string; dia_semana: number; inicio: string; fim: string };
export type Bloqueio = { id: string; profissional_id: string | null; inicio: string; fim: string; motivo: string | null };
export type TelaAgenda = {
  fuso: string; de: string; ate: string; profissionais: Profissional[]; tipos: Tipo[]; grade: Janela[]; bloqueios: Bloqueio[];
  agendamentos: ag.Agendamento[]; config: ag.ConfigAgenda; podeEditar: boolean; podeConfig: boolean;
};

export async function lerAgendaPropria(u: Usuario, de: string | null, ate: string | null): Promise<TelaAgenda> {
  const banco = db(u);
  const d = de && DATA.test(de) ? de : new Date().toISOString().slice(0, 10);
  const a = ate && DATA.test(ate) ? ate : d;
  if ((Date.parse(a) - Date.parse(d)) / 86400000 > 42 || Date.parse(a) < Date.parse(d)) throw new ErroApi(400, 'Período inválido.');
  return consultar(async () => {
    const config = await ag.configAgenda(banco);
    const [p, t, g, b, x] = await Promise.all([
      banco.query('select id, nome, descricao, cor, email, ordem from ag_profissionais where not arquivado order by ordem, nome'),
      banco.query('select id, nome, duracao_min, valor, cor, modalidade, descricao, profissionais, publico, ordem from ag_tipos where not arquivado order by ordem, nome'),
      banco.query(`select id, profissional_id, dia_semana, to_char(inicio, 'HH24:MI') as inicio, to_char(fim, 'HH24:MI') as fim from ag_grade where not arquivado order by dia_semana, inicio`),
      banco.query(`select id, profissional_id, inicio, fim, motivo from ag_bloqueios where not arquivado
                     and fim > ($1::date)::timestamp at time zone $3 and inicio < ($2::date + 1)::timestamp at time zone $3 order by inicio`, [d, a, config.fuso]),
      banco.query(`select a.*, p.nome as profissional, t.nome as tipo, t.cor as tipo_cor, s.nome as sala, c.nome as contato_nome, c.telefone as contato_telefone
                     from ag_agendamentos a join ag_profissionais p on p.id = a.profissional_id join ag_tipos t on t.id = a.tipo_id
                     left join ag_salas s on s.id = a.sala_id left join contatos c on c.id = a.contato_id
                    where not a.arquivado and a.inicio >= ($1::date)::timestamp at time zone $3 and a.inicio < ($2::date + 1)::timestamp at time zone $3
                    order by a.inicio`, [d, a, config.fuso]),
    ]);
    return {
      fuso: config.fuso, de: d, ate: a, config, podeEditar: pode(u, 'agenda.editar'), podeConfig: pode(u, 'agenda.config'),
      profissionais: p.rows.map((r) => ({ ...r, id: String(r.id), ordem: Number(r.ordem) })),
      tipos: t.rows.map((r) => ({ ...r, id: String(r.id), duracao_min: Number(r.duracao_min), valor: r.valor === null ? null : Number(r.valor), ordem: Number(r.ordem), profissionais: (r.profissionais ?? []).map(String) })),
      grade: g.rows.map((r) => ({ id: String(r.id), profissional_id: String(r.profissional_id), dia_semana: Number(r.dia_semana), inicio: r.inicio, fim: r.fim })),
      bloqueios: b.rows.map((r) => ({ id: String(r.id), profissional_id: r.profissional_id ? String(r.profissional_id) : null, inicio: new Date(r.inicio).toISOString(), fim: new Date(r.fim).toISOString(), motivo: r.motivo ?? null })),
      agendamentos: x.rows.map(ag.agendamentoDe),
    };
  });
}

// ---- Agendamentos (mesmas regras da IA) ----

export function marcar(u: Usuario, dados: Record<string, unknown>) {
  db(u, 'agenda.editar');
  return ag.criarAgendamento(ator(u), { ...dados, origem: 'painel' });
}
export function alterar(u: Usuario, id: string, dados: Record<string, unknown>) {
  db(u, 'agenda.editar');
  return ag.alterarAgendamento(ator(u), id, dados);
}
export function horarios(u: Usuario, tipo: string, profissional: string | null, de: string, ate: string) {
  db(u);
  const q = new URLSearchParams({ tipo, de, ate });
  if (profissional) q.set('profissional', profissional);
  return ag.listarHorarios(ator(u), q);
}

// ---- Configuração ----

const txt = (v: unknown, max: number) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };
const cor = (v: unknown) => { const t = txt(v, 7); return t && /^#[0-9a-f]{6}$/i.test(t) ? t : null; };
async function comConfig<T>(u: Usuario, fn: (c: import('pg').PoolClient) => Promise<T>, acao: string, recurso: string, alvo: string | null): Promise<T> {
  const banco = db(u, 'agenda.config');
  return consultar(() => transacao(async (c) => {
    const r = await fn(c);
    await auditarApi(c, ator(u), acao, recurso, alvo ?? (r as { id?: string })?.id ?? null, undefined);
    return r;
  }, banco));
}

export function salvarProfissional(u: Usuario, d: Record<string, unknown>) {
  const nome = txt(d.nome, 120);
  if (!nome) throw new ErroApi(400, 'Informe o nome.');
  const id = d.id ? String(d.id) : null;
  if (id && !UUID.test(id)) throw new ErroApi(400, 'Profissional inválido.');
  return comConfig(u, async (c) => {
    const vals = [nome, txt(d.descricao, 200), cor(d.cor), txt(d.email, 200), Number(d.ordem) || 0];
    const r = id
      ? await c.query('update ag_profissionais set nome = $2, descricao = $3, cor = $4, email = $5, ordem = $6, atualizado_em = now() where id = $1 and not arquivado returning id', [id, ...vals])
      : await c.query('insert into ag_profissionais (nome, descricao, cor, email, ordem) values ($1, $2, $3, $4, $5) returning id', vals);
    if (!r.rowCount) throw new ErroApi(404, 'Profissional não encontrado.');
    return { id: String(r.rows[0].id) };
  }, id ? 'atualizar' : 'criar', 'agenda_profissionais', id);
}

export function salvarTipo(u: Usuario, d: Record<string, unknown>) {
  const nome = txt(d.nome, 120);
  if (!nome) throw new ErroApi(400, 'Informe o nome.');
  const dur = Number(d.duracao_min);
  if (!Number.isInteger(dur) || dur < 5 || dur > 720) throw new ErroApi(400, 'Duração: de 5 a 720 minutos.');
  const valor = d.valor === '' || d.valor === null || d.valor === undefined ? null : Number(d.valor);
  if (valor !== null && (!Number.isFinite(valor) || valor < 0)) throw new ErroApi(400, 'Valor inválido.');
  const modalidade = ['presencial', 'online', 'domicilio'].includes(String(d.modalidade)) ? String(d.modalidade) : 'presencial';
  const profs = Array.isArray(d.profissionais) ? d.profissionais.map(String).filter((x) => UUID.test(x)) : [];
  const id = d.id ? String(d.id) : null;
  if (id && !UUID.test(id)) throw new ErroApi(400, 'Tipo inválido.');
  return comConfig(u, async (c) => {
    const vals = [nome, dur, valor, cor(d.cor), modalidade, txt(d.descricao, 500), profs, d.publico !== false, Number(d.ordem) || 0];
    const r = id
      ? await c.query(`update ag_tipos set nome = $2, duracao_min = $3, valor = $4, cor = $5, modalidade = $6, descricao = $7, profissionais = $8::uuid[],
                         publico = $9, ordem = $10, atualizado_em = now() where id = $1 and not arquivado returning id`, [id, ...vals])
      : await c.query(`insert into ag_tipos (nome, duracao_min, valor, cor, modalidade, descricao, profissionais, publico, ordem)
                       values ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9) returning id`, vals);
    if (!r.rowCount) throw new ErroApi(404, 'Tipo não encontrado.');
    return { id: String(r.rows[0].id) };
  }, id ? 'atualizar' : 'criar', 'agenda_tipos', id);
}

const TABELAS: Record<string, string> = { profissional: 'ag_profissionais', tipo: 'ag_tipos', bloqueio: 'ag_bloqueios' };
export function arquivar(u: Usuario, qual: string, id: string) {
  const tabela = TABELAS[qual];
  if (!tabela || !UUID.test(id)) throw new ErroApi(400, 'Pedido inválido.');
  return comConfig(u, async (c) => {
    const r = await c.query(`update ${tabela} set arquivado = true, atualizado_em = now() where id = $1 and not arquivado returning id`, [id]);
    if (!r.rowCount) throw new ErroApi(404, 'Não encontrado.');
    if (qual === 'profissional') await c.query('update ag_grade set arquivado = true, atualizado_em = now() where profissional_id = $1 and not arquivado', [id]);
    return { id };
  }, 'arquivar', `agenda_${qual}`, id);
}

// Grade de um profissional, inteira de uma vez: [{dia_semana, inicio, fim}]. Substitui a anterior.
export function salvarGrade(u: Usuario, profissional: string, janelas: unknown) {
  if (!UUID.test(profissional)) throw new ErroApi(400, 'Profissional inválido.');
  if (!Array.isArray(janelas) || janelas.length > 70) throw new ErroApi(400, 'Grade inválida.');
  const lista = janelas.map((j) => {
    const x = j as Record<string, unknown>;
    const dia = Number(x.dia_semana); const ini = String(x.inicio ?? ''); const fim = String(x.fim ?? '');
    if (!Number.isInteger(dia) || dia < 0 || dia > 6 || !HORA.test(ini) || !HORA.test(fim) || fim <= ini) throw new ErroApi(400, 'Cada horário precisa de dia, início e fim (fim depois do início).');
    return { dia, ini, fim };
  });
  return comConfig(u, async (c) => {
    const p = await c.query('select 1 from ag_profissionais where id = $1 and not arquivado', [profissional]);
    if (!p.rowCount) throw new ErroApi(404, 'Profissional não encontrado.');
    await c.query('update ag_grade set arquivado = true, atualizado_em = now() where profissional_id = $1 and not arquivado', [profissional]);
    for (const j of lista) await c.query('insert into ag_grade (profissional_id, dia_semana, inicio, fim) values ($1, $2, $3, $4)', [profissional, j.dia, j.ini, j.fim]);
    return { id: profissional, janelas: lista.length };
  }, 'salvar_grade', 'agenda_grade', profissional);
}

export function salvarBloqueio(u: Usuario, d: Record<string, unknown>) {
  const prof = d.profissional_id ? String(d.profissional_id) : null;
  if (prof && !UUID.test(prof)) throw new ErroApi(400, 'Profissional inválido.');
  const ini = new Date(String(d.inicio ?? '')); const fim = new Date(String(d.fim ?? ''));
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime()) || fim <= ini) throw new ErroApi(400, 'Informe início e fim (fim depois do início).');
  return comConfig(u, async (c) => {
    const r = await c.query('insert into ag_bloqueios (profissional_id, inicio, fim, motivo) values ($1, $2, $3, $4) returning id', [prof, ini.toISOString(), fim.toISOString(), txt(d.motivo, 200)]);
    return { id: String(r.rows[0].id) };
  }, 'criar', 'agenda_bloqueios', null);
}

export function salvarConfig(u: Usuario, d: Record<string, unknown>) {
  const n = (v: unknown, min: number, max: number, campo: string) => { const k = Number(v); if (!Number.isInteger(k) || k < min || k > max) throw new ErroApi(400, `${campo}: de ${min} a ${max}.`); return k; };
  const valor = {
    antecedencia_min: n(d.antecedencia_min, 0, 43200, 'Antecedência'), limite_dias: n(d.limite_dias, 1, 365, 'Limite de dias'),
    passo_min: d.passo_min === '' || d.passo_min === null || d.passo_min === undefined ? null : n(d.passo_min, 5, 240, 'Intervalo entre horários'),
    fuso: typeof d.fuso === 'string' && /^[A-Za-z_]+\/[A-Za-z_\/]+$/.test(d.fuso) ? d.fuso : 'America/Sao_Paulo',
  };
  return comConfig(u, async (c) => {
    await c.query(`insert into crm_config (chave, valor) values ('agenda', $1::jsonb) on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`, [JSON.stringify(valor)]);
    return { id: 'agenda' };
  }, 'salvar_config', 'agenda_config', 'agenda');
}
