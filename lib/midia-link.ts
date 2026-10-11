import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { central } from '@/lib/db';

// Link curto de mídia (Inbox e comprovante): token aleatório que o receptor troca pelo arquivo do Storage enquanto
// vale. O link fica no banco DA EMPRESA, o mesmo em que o receptor grava as mensagens (migração 020); o endereço leva
// a empresa para o receptor saber em qual banco procurar. Banco da empresa ainda sem a 020: grava na central, como
// antes (migração 011), com o endereço antigo.
export const baseReceptor = () => (process.env.RECEPTOR_URL || `https://${process.env.PAINEL_HOST_ADM || 'adm.planeelabia.com'}`).replace(/\/+$/, '');

export async function criarLinkMidia(banco: Pool | PoolClient, empresa: string, caminho: string, mime: string | null, minutos: number): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const sql = `insert into wa_midia_links (token, empresa_id, caminho, mime, expira_em) values ($1, $2, $3, $4, now() + make_interval(mins => $5))`;
  const vals = [token, empresa, caminho, mime, minutos];
  try {
    await banco.query(sql, vals);
    return `${baseReceptor()}/whatsapp/midia/${encodeURIComponent(empresa)}/${token}`;
  } catch (e) {
    if ((e as { code?: string }).code !== '42P01') throw e;
  }
  await central().query(sql, vals);
  return `${baseReceptor()}/whatsapp/midia/${token}`;
}
