import 'server-only';
import type { Pool } from 'pg';
import { bancoDaEmpresa, ErroApi, registrarErro } from '@/lib/db';
import { pode, type Usuario } from '@/lib/sessao';
import { fuso } from './crm';

// Resultados da empresa (fase 1.3, 09/10). Tudo sai das tabelas do modelo padrão no banco da empresa (decisão 22):
// espelho do WhatsApp (wa_mensagens), quadro (atendimentos), agendamentos (servicos), funil (oportunidades),
// mensagens automáticas (envios_automaticos) e comprovantes (pagamentos). Cada bloco é uma consulta; as consultas
// rodam em paralelo. Tabela que a empresa ainda não tem (migração não rodada): o bloco volta vazio, sem erro.
// Só números agregados: nenhum nome, telefone ou texto de paciente sai daqui.

export type Periodo = '7' | '30' | '90' | 'mes';
const PERIODOS: Periodo[] = ['7', '30', '90', 'mes'];

export type Resultados = {
  periodo: Periodo; de: string; ate: string; fuso: string; lidoEm: string;
  conversas: null | {
    contatos: number; recebidas: number; respostasSara: number; respostasEquipe: number; soSara: number;
    porDia: { dia: string; contatos: number; recebidas: number }[];
  };
  espera: null | { respostas: number; mediana_min: number | null; faixas: { rotulo: string; qtde: number }[] };
  quadro: null | {
    abertos: number; finalizados: number; assumidos: number; mediana_assumir_min: number | null; mediana_finalizar_min: number | null;
    agora: { topico: string; nome: string; aguardando: number; em_atendimento: number; pendente: number; abertos_periodo: number }[];
    pessoas: { nome: string; assumidos: number; finalizados: number }[];
  };
  agenda: null | { total: number; pelaIa: number; porSituacao: { situacao: string; qtde: number }[]; porTipo: { tipo: string; qtde: number }[] };
  funil: null | { novas: number; ganhas: number; perdidas: number; valorGanho: number };
  automaticas: null | { tipo: string; enviado: number; falhou: number; cancelado: number }[];
  comprovantes: null | { total: number; suspeitos: number; conferidos: number; valor: number };
};

function db(u: Usuario) {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para ver os resultados.');
  if (!pode(u, 'resultados.ver')) throw new ErroApi(403, 'Você não tem acesso aos resultados nesta empresa.');
  return bancoDaEmpresa(u.empresa);
}

// Bloco que depende de uma tabela que a empresa pode ainda não ter: falta de tabela/coluna = bloco vazio.
async function bloco<T>(nome: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) {
    if (['42P01', '42703'].includes((e as { code?: string }).code ?? '')) return null;
    registrarErro(`resultados (${nome})`, e);
    return null;
  }
}

const n = (v: unknown) => Number(v) || 0;
const nOuNulo = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function lerResultados(u: Usuario, periodoPedido?: string | null): Promise<Resultados> {
  const banco: Pool = db(u);
  const periodo: Periodo = PERIODOS.includes(periodoPedido as Periodo) ? (periodoPedido as Periodo) : '30';
  const f = fuso();
  // Início do período no fuso do painel: hoje menos N-1 dias à meia-noite, ou o dia 1º do mês.
  const ini = await banco.query(
    `select (case when $2 = 'mes' then date_trunc('month', now() at time zone $1)
                  else date_trunc('day', now() at time zone $1) - make_interval(days => $3::int - 1) end) at time zone $1 as de`,
    [f, periodo, periodo === 'mes' ? 1 : Number(periodo)]);
  const de: Date = ini.rows[0].de;
  const P = [de, f];

  const [conversas, espera, quadro, agenda, funil, automaticas, comprovantes] = await Promise.all([
    bloco('conversas', async () => {
      const r = await banco.query(
        `with m as (select wa_id, direcao, origem, enviada_em from wa_mensagens where enviada_em >= $1 and tipo <> 'reaction'),
              quem as (select distinct wa_id from m where direcao = 'entrada'),
              equipe as (select distinct wa_id from m where direcao = 'saida' and origem in ('celular', 'painel'))
         select (select count(*) from quem) as contatos,
                (select count(*) from m where direcao = 'entrada') as recebidas,
                (select count(*) from m where direcao = 'saida' and origem = 'api') as sara,
                (select count(*) from m where direcao = 'saida' and origem in ('celular', 'painel')) as equipe,
                (select count(*) from quem q where not exists (select 1 from equipe e where e.wa_id = q.wa_id)) as so_sara,
                (select coalesce(json_agg(x order by x.dia), '[]'::json) from (
                   select to_char(date_trunc('day', enviada_em at time zone $2), 'YYYY-MM-DD') as dia,
                          count(distinct wa_id) as contatos, count(*) as recebidas
                     from m where direcao = 'entrada' group by 1) x) as por_dia`, P);
      const x = r.rows[0];
      return {
        contatos: n(x.contatos), recebidas: n(x.recebidas), respostasSara: n(x.sara), respostasEquipe: n(x.equipe), soSara: n(x.so_sara),
        porDia: (x.por_dia as { dia: string; contatos: number; recebidas: number }[]).map((d) => ({ dia: d.dia, contatos: n(d.contatos), recebidas: n(d.recebidas) })),
      };
    }),
    // Quanto o paciente espera pela equipe: para cada resposta da equipe (celular ou painel), o tempo desde a primeira
    // mensagem do paciente depois da resposta anterior da equipe (mensagens da Sara no meio não contam). Até 24 h.
    bloco('espera', async () => {
      const r = await banco.query(
        `with m as (
           select numero_id, wa_id, enviada_em, direcao, (direcao = 'saida' and origem in ('celular', 'painel')) as equipe
             from wa_mensagens where enviada_em >= $1::timestamptz - interval '1 day' and tipo <> 'reaction'),
         b as (
           select *, count(*) filter (where equipe) over (partition by numero_id, wa_id order by enviada_em rows between unbounded preceding and 1 preceding) as bloco
             from m),
         primeira as (select numero_id, wa_id, bloco, min(enviada_em) as desde from b where direcao = 'entrada' group by 1, 2, 3),
         resp as (
           select extract(epoch from (r.enviada_em - p.desde)) / 60 as min
             from b r join primeira p on p.numero_id = r.numero_id and p.wa_id = r.wa_id and p.bloco = r.bloco
            where r.equipe and r.enviada_em >= $1::timestamptz and r.enviada_em - p.desde <= interval '24 hours')
         select count(*) as total, percentile_cont(0.5) within group (order by min) as mediana,
                count(*) filter (where min <= 15) as a, count(*) filter (where min > 15 and min <= 60) as b,
                count(*) filter (where min > 60 and min <= 240) as c, count(*) filter (where min > 240) as d
           from resp`, [de]);
      const x = r.rows[0];
      return {
        respostas: n(x.total), mediana_min: nOuNulo(x.mediana),
        faixas: [
          { rotulo: 'Até 15 min', qtde: n(x.a) }, { rotulo: '15 min a 1 h', qtde: n(x.b) },
          { rotulo: '1 h a 4 h', qtde: n(x.c) }, { rotulo: 'Mais de 4 h', qtde: n(x.d) },
        ],
      };
    }),
    bloco('quadro', async () => {
      const r = await banco.query(
        `with a as (select * from atendimentos where not arquivado and resumo !~ '^\\s*\\[SOMBRA\\]'),
              p as (select * from a where aberto_em >= $1)
         select (select count(*) from p) as abertos,
                (select count(*) from a where finalizado_em >= $1) as finalizados,
                (select count(*) from a where assumido_em >= $1) as assumidos,
                (select percentile_cont(0.5) within group (order by extract(epoch from (assumido_em - aberto_em)) / 60) from p where assumido_em is not null) as med_assumir,
                (select percentile_cont(0.5) within group (order by extract(epoch from (finalizado_em - aberto_em)) / 60) from p where finalizado_em is not null) as med_finalizar,
                (select coalesce(json_agg(x order by x.ordem, x.nome), '[]'::json) from (
                   select t.id as topico, t.nome, t.ordem,
                          count(*) filter (where a.etapa = 'aguardando') as aguardando,
                          count(*) filter (where a.etapa = 'em_atendimento') as em_atendimento,
                          count(*) filter (where a.etapa = 'pendente') as pendente,
                          count(*) filter (where a.aberto_em >= $1) as abertos_periodo
                     from crm_topicos t left join a on a.topico_id = t.id
                    where not t.arquivado group by t.id, t.nome, t.ordem) x) as agora,
                (select coalesce(json_agg(x order by x.finalizados desc, x.assumidos desc), '[]'::json) from (
                   select responsavel as nome, count(*) filter (where assumido_em >= $1) as assumidos, count(*) filter (where finalizado_em >= $1) as finalizados
                     from a where responsavel is not null and (assumido_em >= $1 or finalizado_em >= $1) group by responsavel) x) as pessoas`, [de]);
      const x = r.rows[0];
      return {
        abertos: n(x.abertos), finalizados: n(x.finalizados), assumidos: n(x.assumidos),
        mediana_assumir_min: nOuNulo(x.med_assumir), mediana_finalizar_min: nOuNulo(x.med_finalizar),
        agora: (x.agora as Record<string, unknown>[]).map((t) => ({
          topico: String(t.topico), nome: String(t.nome), aguardando: n(t.aguardando), em_atendimento: n(t.em_atendimento), pendente: n(t.pendente), abertos_periodo: n(t.abertos_periodo),
        })),
        pessoas: (x.pessoas as Record<string, unknown>[]).slice(0, 20).map((p) => ({ nome: String(p.nome), assumidos: n(p.assumidos), finalizados: n(p.finalizados) })),
      };
    }),
    // Agendamentos registrados no CRM. "Pela IA": registrados por uma chave da API (a Sara), não por pessoa no painel.
    bloco('agenda', async () => {
      const r = await banco.query(
        `with s as (select * from servicos where not arquivado and criado_em >= $1)
         select (select count(*) from s) as total,
                (select count(*) from s where criado_por in (select nome from api_chaves)) as ia,
                (select coalesce(json_agg(x order by x.qtde desc), '[]'::json) from (select situacao, count(*) as qtde from s group by 1) x) as situacao,
                (select coalesce(json_agg(x order by x.qtde desc), '[]'::json) from (select tipo, count(*) as qtde from s group by 1 order by 2 desc limit 8) x) as tipo`, [de]);
      const x = r.rows[0];
      return {
        total: n(x.total), pelaIa: n(x.ia),
        porSituacao: (x.situacao as Record<string, unknown>[]).map((y) => ({ situacao: String(y.situacao), qtde: n(y.qtde) })),
        porTipo: (x.tipo as Record<string, unknown>[]).map((y) => ({ tipo: String(y.tipo), qtde: n(y.qtde) })),
      };
    }),
    bloco('funil', async () => {
      const r = await banco.query(
        `select count(*) filter (where o.criado_em >= $1) as novas,
                count(*) filter (where e.tipo = 'ganho' and o.atualizado_em >= $1) as ganhas,
                count(*) filter (where e.tipo = 'perdido' and o.atualizado_em >= $1) as perdidas,
                coalesce(sum(o.valor) filter (where e.tipo = 'ganho' and o.atualizado_em >= $1), 0) as valor
           from oportunidades o join crm_etapas e on e.id = o.etapa_id where not o.arquivado`, [de]);
      const x = r.rows[0];
      return { novas: n(x.novas), ganhas: n(x.ganhas), perdidas: n(x.perdidas), valorGanho: n(x.valor) };
    }),
    bloco('automaticas', async () => {
      const r = await banco.query(
        `select tipo, count(*) filter (where situacao = 'enviado') as enviado, count(*) filter (where situacao = 'falhou') as falhou,
                count(*) filter (where situacao = 'cancelado') as cancelado
           from envios_automaticos where quando >= $1 group by tipo order by count(*) desc`, [de]);
      return r.rows.map((x) => ({ tipo: String(x.tipo), enviado: n(x.enviado), falhou: n(x.falhou), cancelado: n(x.cancelado) }));
    }),
    bloco('comprovantes', async () => {
      const r = await banco.query(
        `select count(*) as total, count(*) filter (where analise = 'suspeito') as suspeitos, count(*) filter (where conferido_em is not null) as conferidos,
                coalesce(sum(valor), 0) as valor
           from pagamentos where not arquivado and criado_em >= $1`, [de]);
      const x = r.rows[0];
      return { total: n(x.total), suspeitos: n(x.suspeitos), conferidos: n(x.conferidos), valor: n(x.valor) };
    }),
  ]);

  return { periodo, de: de.toISOString(), ate: new Date().toISOString(), fuso: f, lidoEm: new Date().toISOString(), conversas, espera, quadro, agenda, funil, automaticas, comprovantes };
}
