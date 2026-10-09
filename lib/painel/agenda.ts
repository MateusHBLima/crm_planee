import 'server-only';
import { bancoDaEmpresa, ErroApi } from '@/lib/db';
import { pode, type Usuario } from '@/lib/sessao';
import { fuso } from './crm';
import { tokenFeegow } from '@/lib/agenda/feegow';

// Tela Agenda (09/10): os agendamentos de um dia, de todos os profissionais, lidos de "servicos" no banco da empresa
// (o espelho da Feegow e os que a Sara registra). Mostra também como está o espelho (última leitura, carga do
// histórico). Permissão: ver agendamentos e comprovantes (pagamentos.ver).

export type ItemAgenda = {
  id: string; inicio: string | null; tipo: string; profissional: string | null; local: string | null;
  situacao: string; status: string | null; origem: 'sara' | 'feegow' | 'equipe'; teleconsulta: boolean; encaixe: boolean; primeira: boolean;
  contato: { id: string; nome: string | null; telefone: string | null };
};
export type DiaAgenda = {
  dia: string; fuso: string; lidoEm: string; itens: ItemAgenda[];
  espelho: { configurado: boolean; ultima_ok: string | null; ultima_rodada: string | null; carga_ate: string | null; carga_completa: boolean; ultimo_erro: string | null } | null;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function lerAgenda(u: Usuario, diaPedido?: string | null): Promise<DiaAgenda> {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir a agenda.');
  if (!pode(u, 'pagamentos.ver')) throw new ErroApi(403, 'Você não tem acesso à agenda nesta empresa.');
  const f = fuso();
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: f, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(diaPedido ?? '')) ? String(diaPedido) : hoje;
  const db = bancoDaEmpresa(u.empresa);
  let linhas: Record<string, unknown>[] = [];
  try {
    const r = await db.query(
      `select s.id, s.inicio, s.tipo, s.profissional, s.local, s.situacao, s.criado_por, s.detalhes->'feegow' as fg,
              c.id as contato_id, c.nome, c.telefone, (s.criado_por = 'IA' or s.criado_por in (select nome from api_chaves)) as pela_ia
         from servicos s join contatos c on c.id = s.contato_id
        where not s.arquivado and s.inicio >= ($1::date::timestamp at time zone $2) and s.inicio < (($1::date + 1)::timestamp at time zone $2)
        order by s.inicio, s.profissional nulls last limit 500`, [dia, f]);
    linhas = r.rows;
  } catch (e) {
    if (['42P01', '42703'].includes((e as { code?: string }).code ?? '')) throw new ErroApi(503, 'Os agendamentos ainda não foram instalados no banco desta empresa (migração 013).');
    throw e;
  }
  let espelho: DiaAgenda['espelho'] = null;
  try {
    const r = await db.query(`select * from agenda_espelho where sistema = 'feegow'`);
    const x = r.rows[0];
    espelho = {
      configurado: Boolean(tokenFeegow(u.empresa.id)), ultima_ok: iso(x?.ultima_ok), ultima_rodada: iso(x?.ultima_rodada),
      carga_ate: x?.carga_ate ? new Date(x.carga_ate).toISOString().slice(0, 10) : null, carga_completa: Boolean(x?.carga_completa),
      ultimo_erro: (x?.ultimo_erro as string) ?? null,
    };
  } catch { espelho = null; }
  const itens: ItemAgenda[] = linhas.map((x) => {
    const fg = (x.fg ?? {}) as Record<string, unknown>;
    return {
      id: String(x.id), inicio: iso(x.inicio), tipo: String(x.tipo ?? ''), profissional: (x.profissional as string) ?? null, local: (x.local as string) ?? null,
      situacao: String(x.situacao), status: (fg.status as string) ?? null,
      origem: x.pela_ia ? 'sara' : x.criado_por === 'Feegow (espelho)' ? 'feegow' : 'equipe',
      teleconsulta: Boolean(fg.telemedicina) || /online|tele/i.test(String(x.local ?? '')), encaixe: Boolean(fg.encaixe), primeira: Boolean(fg.primeiro),
      // Nome do paciente da consulta como está na Feegow (mãe e filho com o mesmo telefone caem no mesmo contato).
      contato: { id: String(x.contato_id), nome: (fg.paciente_nome as string) || ((x.nome as string) ?? null), telefone: (x.telefone as string) ?? null },
    };
  });
  return { dia, fuso: f, lidoEm: new Date().toISOString(), itens, espelho };
}
