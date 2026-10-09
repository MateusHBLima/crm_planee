import 'server-only';
import type { Pool, PoolClient } from 'pg';

// Leitura das mensagens automáticas da IA (migração 017): recusa no contato, últimos envios e o selo do follow-up.
// Usado pela ficha da API, pela Inbox e pelo histórico do contato. Banco sem a 017: tudo vazio, nada quebra.

// Nomes dos tipos ficam num arquivo sem 'server-only' (a tela de Resultados também usa).
export { TIPOS_AUTOMATICA } from './automaticas-nomes';
import { TIPOS_AUTOMATICA } from './automaticas-nomes';
export const nomeDoTipo = (t: string) => TIPOS_AUTOMATICA[t] ?? `Automática (${t})`;

export type Recusa = { desde: string; motivo: string | null; por: string | null };
export type EnvioAutomatico = {
  id: string; contato_id: string; tipo: string; tipo_nome: string; situacao: 'enviado' | 'falhou' | 'cancelado'; motivo: string | null;
  texto: string | null; wamid: string | null; quando: string; servico_id: string | null; criado_por: string | null;
};
export type Selo = { tipo: 'parou' | 'followup' | 'sem_resposta' | 'respondeu'; texto: string; desde: string };

const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const iso = (v: unknown) => new Date(v as string).toISOString();
type Banco = Pool | PoolClient;

function limparEnvio(r: Record<string, unknown>): EnvioAutomatico {
  return {
    id: String(r.id), contato_id: String(r.contato_id), tipo: String(r.tipo), tipo_nome: nomeDoTipo(String(r.tipo)),
    situacao: r.situacao as EnvioAutomatico['situacao'], motivo: (r.motivo as string) ?? null, texto: (r.texto as string) ?? null,
    wamid: (r.wamid as string) ?? null, quando: iso(r.quando), servico_id: (r.servico_id as string) ?? null, criado_por: (r.criado_por as string) ?? null,
  };
}

// Recusa de um conjunto de contatos (o mesmo telefone pode ter mais de um cadastro): vale a mais antiga.
export async function recusaDe(b: Banco, contatoIds: string[]): Promise<Recusa | null> {
  if (!contatoIds.length) return null;
  try {
    const r = await b.query(
      `select automaticas_paradas_em, automaticas_motivo, automaticas_por from contatos
        where id = any($1::uuid[]) and automaticas_paradas_em is not null order by automaticas_paradas_em limit 1`, [contatoIds]);
    const x = r.rows[0];
    return x ? { desde: iso(x.automaticas_paradas_em), motivo: x.automaticas_motivo ?? null, por: x.automaticas_por ?? null } : null;
  } catch (e) { if (semTabela(e)) return null; throw e; }
}

export async function enviosDe(b: Banco, contatoIds: string[], limite = 10): Promise<EnvioAutomatico[]> {
  if (!contatoIds.length) return [];
  try {
    const r = await b.query(
      `select * from envios_automaticos where contato_id = any($1::uuid[]) order by quando desc limit $2`, [contatoIds, limite]);
    return r.rows.map(limparEnvio);
  } catch (e) { if (semTabela(e)) return []; throw e; }
}

// O que vai na ficha da API: se pode enviar, a recusa e os últimos envios.
export async function resumoParaFicha(b: Banco, contatoIds: string[]) {
  const [recusa, envios] = await Promise.all([recusaDe(b, contatoIds), enviosDe(b, contatoIds, 10)]);
  return { permitidas: !recusa, desde: recusa?.desde ?? null, motivo: recusa?.motivo ?? null, por: recusa?.por ?? null, ultimos_envios: envios };
}

const UMA_HORA = 3600_000;
const MOSTRA_RESPOSTA_MS = 2 * 86400_000;   // "Respondeu ao follow-up" some 2 dias depois da resposta
const FOLLOWUP_VALE_MS = 31 * 86400_000;

// Selo do contato: recusa vence tudo; senão, o último follow-up (enviado e sem resposta, ou respondido há pouco).
export function calcularSelo(recusa: Recusa | null, ultimoFollowup: EnvioAutomatico | null, ultimaEntrada: string | null, agora = Date.now()): Selo | null {
  if (recusa) return { tipo: 'parou', texto: `Parou: pediu para não receber${recusa.motivo ? ` (${recusa.motivo})` : ''}`, desde: recusa.desde };
  const f = ultimoFollowup;
  if (!f || agora - new Date(f.quando).getTime() > FOLLOWUP_VALE_MS) return null;
  const entrada = ultimaEntrada ? new Date(ultimaEntrada).getTime() : 0;
  const enviadoEm = new Date(f.quando).getTime();
  if (entrada > enviadoEm) {
    return agora - entrada <= MOSTRA_RESPOSTA_MS ? { tipo: 'respondeu', texto: 'Respondeu ao follow-up', desde: new Date(entrada).toISOString() } : null;
  }
  if (f.situacao !== 'enviado') return null;
  const nome = f.tipo_nome.replace(/^Follow-up /, '');
  return agora - enviadoEm >= UMA_HORA
    ? { tipo: 'sem_resposta', texto: `Follow-up ${nome} enviado · sem resposta`, desde: f.quando }
    : { tipo: 'followup', texto: `Follow-up ${nome} enviado`, desde: f.quando };
}

// Selo pelo telefone (Inbox): contatos com o mesmo DDD + 8 últimos dígitos. Uma ida só ao banco (contatos, recusa e
// último follow-up juntos): o banco da clínica fica em outra região e cada ida custa ~0,2 s (09/10).
export async function seloDoTelefone(b: Banco, waId: string, ultimaEntrada: string | null): Promise<Selo | null> {
  const d = String(waId ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  try {
    const r = await b.query(
      `with cs as (
         select id, automaticas_paradas_em, automaticas_motivo, automaticas_por from contatos
          where not arquivado and substr(regexp_replace(telefone, '\\D', '', 'g'), 3, 2) = $1
            and right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $2)
       select (select row_to_json(x) from (select automaticas_paradas_em, automaticas_motivo, automaticas_por from cs
                 where automaticas_paradas_em is not null order by automaticas_paradas_em limit 1) x) as recusa,
              (select row_to_json(e) from (select * from envios_automaticos where contato_id in (select id from cs)
                 and tipo like 'followup%' order by quando desc limit 1) e) as followup`, [d.slice(2, 4), d.slice(-8)]);
    const x = r.rows[0] ?? {};
    if (x.recusa) {
      const rc = x.recusa as Record<string, unknown>;
      return calcularSelo({ desde: iso(rc.automaticas_paradas_em), motivo: (rc.automaticas_motivo as string) ?? null, por: (rc.automaticas_por as string) ?? null }, null, null);
    }
    return calcularSelo(null, x.followup ? limparEnvio(x.followup as Record<string, unknown>) : null, ultimaEntrada);
  } catch (e) { if (semTabela(e)) return null; throw e; }
}

export async function seloDosContatos(b: Banco, contatoIds: string[], ultimaEntrada: string | null): Promise<Selo | null> {
  if (!contatoIds.length) return null;
  const recusa = await recusaDe(b, contatoIds);
  if (recusa) return calcularSelo(recusa, null, null);
  try {
    const r = await b.query(
      `select * from envios_automaticos where contato_id = any($1::uuid[]) and tipo like 'followup%' order by quando desc limit 1`, [contatoIds]);
    return calcularSelo(null, r.rows[0] ? limparEnvio(r.rows[0]) : null, ultimaEntrada);
  } catch (e) { if (semTabela(e)) return null; throw e; }
}
