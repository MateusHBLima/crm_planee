import 'server-only';
import type { PoolClient } from 'pg';
import { ErroApi } from '@/lib/db';

// Idempotência por "chave" na API (migração 029, 23/10). A mesma chave na mesma rota devolve o que a primeira
// chamada criou, com repetido = true: um reenvio do n8n não duplica cartão, nota nem oportunidade.
// Roda dentro da transação da escrita: a trava (pg_advisory_xact_lock) segura dois reenvios simultâneos até
// o primeiro gravar, e solta sozinha no fim da transação.

export const ROTAS_COM_CHAVE = ['atendimentos', 'notas', 'oportunidades', 'funil'] as const;

// Lê e tira "chave" do corpo. undefined = sem idempotência (como antes).
export function tirarChave(corpo: unknown): { chave: string | undefined; resto: unknown } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo) || !('chave' in corpo)) return { chave: undefined, resto: corpo };
  const { chave, ...resto } = corpo as Record<string, unknown>;
  if (chave === undefined || chave === null || chave === '') return { chave: undefined, resto };
  const t = String(chave).trim();
  if (!t || t.length > 200) throw new ErroApi(400, '"chave" precisa ter de 1 a 200 caracteres.');
  return { chave: t, resto };
}

export type Repetido = { recurso: string; alvo_id: string; resposta: Record<string, unknown> };

// Trava a chave e devolve o registro da primeira chamada, se houver.
export async function travarChave(c: PoolClient, rota: string, chave: string): Promise<Repetido | null> {
  try {
    await c.query('select pg_advisory_xact_lock(hashtextextended($1, 29))', [`${rota}|${chave}`]);
    const r = await c.query('select recurso, alvo_id, resposta from api_idempotencia where rota = $1 and chave = $2', [rota, chave]);
    return r.rowCount ? (r.rows[0] as Repetido) : null;
  } catch (e) { semTabela(e); }
}

export async function guardarChave(c: PoolClient, rota: string, chave: string, recurso: string, alvoId: string, resposta: unknown) {
  try {
    await c.query(
      'insert into api_idempotencia (rota, chave, recurso, alvo_id, resposta) values ($1, $2, $3, $4, $5)',
      [rota, chave, recurso, alvoId, JSON.stringify(resposta)]);
  } catch (e) { semTabela(e); }
}

function semTabela(e: unknown): never {
  if ((e as { code?: string }).code === '42P01') {
    throw new ErroApi(503, '"chave" ainda não funciona no banco desta empresa (falta a migração 029). Mande sem "chave" ou peça a migração.');
  }
  throw e;
}
