import 'server-only';
import type { Pool, PoolClient } from 'pg';

// Funil comercial andando sozinho (12/10, migração 023). As etapas são de cada empresa, então as regras ficam em
// crm_config "funil_automatico" (sem a chave, nada se move sozinho). Exemplo:
//   { "followup": "followup", "retomada": "retomada", "de": ["contato", "interesse", "oferecido"], "perdido": "perdido", "dias_sem_resposta": 7 }
// • follow-up (followup_*) ou retomada (retomada*) enviados (POST /api/v1/automaticas/envios) → a oportunidade viva que
//   está numa etapa de "de" vai para "followup" (ou "retomada", se configurada), guardando de onde saiu; se já está
//   numa dessas duas, troca para a do tipo novo e só renova a data (a etapa de origem continua a primeira);
// • o paciente respondeu depois do último toque (Inbox) → volta para a etapa de onde saiu;
// • "dias_sem_resposta" dias sem resposta depois do último toque → "perdido" (marcado em perdido_auto_em);
// • perdido pelo funil automático e a pessoa respondeu em até 30 dias → volta para a etapa de onde saiu (12/10:
//   se o receptor cair, a resposta chega atrasada e ninguém fica perdido sem merecer). /funil reabre essa mesma
//   oportunidade em vez de criar outra (lib/api/servico.ts).
// As duas últimas rodam no vigia (lib/painel/vigia.ts), de 15 em 15 minutos, e no "Verificar agora" do Interno.
// Toda mudança fica na auditoria (detalhe.por = "Funil automático").

export type RegrasFunil = { followup: string; retomada: string | null; de: string[]; perdido: string | null; dias: number; cancelada: string | null };
type Banco = Pool | PoolClient;
const ID = /^[a-z0-9_]{1,40}$/;
const semColuna = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');

export function limparRegras(v: unknown): RegrasFunil | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const followup = String(x.followup ?? '');
  const ret = x.retomada == null || x.retomada === '' ? null : String(x.retomada);
  const retomada = ret && ID.test(ret) && ret !== followup ? ret : null;
  const de = Array.isArray(x.de) ? x.de.map(String).filter((s) => ID.test(s) && s !== followup && s !== retomada) : [];
  if (!ID.test(followup) || !de.length) return null;
  const perdido = x.perdido == null || x.perdido === '' ? null : String(x.perdido);
  const dias = Number(x.dias_sem_resposta ?? 7);
  const canc = x.cancelada == null || x.cancelada === '' ? null : String(x.cancelada);
  return { followup, retomada, de, perdido: perdido && ID.test(perdido) ? perdido : null, dias: Number.isInteger(dias) && dias >= 1 && dias <= 90 ? dias : 7,
    cancelada: canc && ID.test(canc) ? canc : null };
}

// Etapas em que o funil automático segura a oportunidade enquanto espera resposta.
const etapasDeEspera = (r: RegrasFunil) => (r.retomada ? [r.followup, r.retomada] : [r.followup]);
export function etapaDoTipo(r: RegrasFunil, tipo: string): string {
  return /^retomada/.test(tipo) && r.retomada ? r.retomada : r.followup;
}

export async function lerRegras(b: Banco): Promise<RegrasFunil | null> {
  const r = await b.query(`select valor from crm_config where chave = 'funil_automatico'`);
  return limparRegras(r.rows[0]?.valor);
}

async function auditarSistema(b: Banco, id: string, detalhe: Record<string, unknown>) {
  await b.query(`insert into painel_auditoria (acao, recurso, alvo_id, detalhe) values ('atualizar', 'oportunidades', $1, $2)`,
    [id, JSON.stringify({ ...detalhe, por: 'Funil automático' })]);
}

// Dentro da transação do registro do envio. Savepoint: banco sem a 023 não derruba o registro.
export async function aposFollowupEnviado(c: PoolClient, contatoIds: string[], quando: string, tipo: string): Promise<{ id: string; de: string } | null> {
  if (!contatoIds.length) return null;
  await c.query('savepoint funil_auto');
  try {
    const regras = await lerRegras(c);
    if (!regras) { await c.query('release savepoint funil_auto'); return null; }
    const alvo = etapaDoTipo(regras, tipo);
    const r = await c.query(
      `with viva as (
         select o.id, o.etapa_id from oportunidades o join crm_etapas e on e.id = o.etapa_id
          where o.contato_id = any($1::uuid[]) and not o.arquivado and e.tipo = 'aberta'
          order by o.atualizado_em desc limit 1 for update of o)
       update oportunidades o
          set etapa_antes_followup = case when viva.etapa_id = any($5::text[]) then o.etapa_antes_followup else viva.etapa_id end,
              etapa_id = $2, followup_em = greatest(coalesce(o.followup_em, $4::timestamptz), $4::timestamptz),
              perdido_auto_em = null, atualizado_em = now()
         from viva
        where o.id = viva.id and (viva.etapa_id = any($3::text[]) or viva.etapa_id = any($5::text[]))
          and exists (select 1 from crm_etapas where id = $2 and not arquivado)
       returning o.id, viva.etapa_id as de`, [contatoIds, alvo, regras.de, quando, etapasDeEspera(regras)]);
    const x = r.rows[0];
    if (x && x.de !== alvo) await auditarSistema(c, String(x.id), { de: x.de, etapa_id: alvo, motivo: `${tipo} enviado` });
    await c.query('release savepoint funil_auto');
    return x ? { id: String(x.id), de: String(x.de) } : null;
  } catch (e) {
    await c.query('rollback to savepoint funil_auto');
    if (semColuna(e)) return null;
    throw e;
  }
}

// Rodada do vigia: quem respondeu volta (inclusive de "perdido", até 30 dias); quem passou do prazo vai para "perdido".
const SQL_RESPONDEU = `exists (select 1 from contatos c join wa_conversas w
                   on substr(w.wa_id, 3, 2) = substr(regexp_replace(c.telefone, '\\D', '', 'g'), 3, 2)
                  and right(w.wa_id, 8) = right(regexp_replace(c.telefone, '\\D', '', 'g'), 8)
                where c.id = o.contato_id and w.ultima_entrada_em > o.followup_em)`;

export async function rodarFunilAutomatico(b: Banco): Promise<{ voltaram: number; perdidos: number }> {
  let regras: RegrasFunil | null;
  try { regras = await lerRegras(b); } catch (e) { if (semColuna(e)) return { voltaram: 0, perdidos: 0 }; throw e; }
  if (!regras) return { voltaram: 0, perdidos: 0 };
  const volta = regras.de[regras.de.length - 1];
  try {
    // Respondeu depois do último toque: sai de follow-up/retomada, ou de "perdido" se foi o funil automático que pôs
    // lá há até 30 dias, e volta para a etapa de onde saiu.
    const v = await b.query(
      `update oportunidades o
          set etapa_id = coalesce((select id from crm_etapas where id = o.etapa_antes_followup and not arquivado), $2),
              etapa_antes_followup = null, followup_em = null, perdido_auto_em = null, atualizado_em = now()
        where not o.arquivado and o.followup_em is not null
          and (o.etapa_id = any($1::text[]) or (o.etapa_id = $3 and o.perdido_auto_em > now() - interval '30 days'))
          and ${SQL_RESPONDEU}
       returning o.id, o.etapa_id`, [etapasDeEspera(regras), volta, regras.perdido ?? '']);
    for (const x of v.rows) await auditarSistema(b, String(x.id), { etapa_id: x.etapa_id, motivo: 'paciente respondeu ao follow-up' });
    let perdidos = 0;
    if (regras.perdido) {
      const p = await b.query(
        `update oportunidades o set etapa_id = $2, perdido_auto_em = now(), atualizado_em = now()
          where not o.arquivado and o.etapa_id = any($1::text[]) and o.followup_em is not null
            and o.followup_em < now() - make_interval(days => $3::int)
            and exists (select 1 from crm_etapas where id = $2 and not arquivado)
          returning o.id`, [etapasDeEspera(regras), regras.perdido, regras.dias]);
      for (const x of p.rows) await auditarSistema(b, String(x.id), { etapa_id: regras.perdido, motivo: `${regras.dias} dias sem resposta ao follow-up` });
      perdidos = p.rowCount ?? 0;
    }
    let reabertas = 0;
    if (regras.cancelada) {
      // Consulta cancelada (migração 013; sem ela, nada a fazer): ganho volta para a etapa configurada.
      try {
        const cn = await b.query(
          `update oportunidades o set etapa_id = $1, atualizado_em = now()
             from crm_etapas e
            where e.id = o.etapa_id and e.tipo = 'ganho' and not o.arquivado
              and exists (select 1 from servicos s where s.contato_id = o.contato_id and not s.arquivado and s.situacao = 'cancelado'
                             and s.atualizado_em > o.atualizado_em and s.atualizado_em > now() - interval '30 days')
              and not exists (select 1 from servicos s where s.contato_id = o.contato_id and not s.arquivado
                                 and s.situacao in ('agendado', 'confirmado') and s.inicio > now())
              and exists (select 1 from crm_etapas where id = $1 and not arquivado)
           returning o.id`, [regras.cancelada]);
        for (const x of cn.rows) await auditarSistema(b, String(x.id), { etapa_id: regras.cancelada, motivo: 'consulta cancelada, sem outra marcada' });
        reabertas = cn.rowCount ?? 0;
      } catch (e) { if (!semColuna(e)) throw e; }
    }
    return { voltaram: (v.rowCount ?? 0) + reabertas, perdidos };
  } catch (e) { if (semColuna(e)) return { voltaram: 0, perdidos: 0 }; throw e; }
}
