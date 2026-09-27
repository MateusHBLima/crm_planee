import 'server-only';
import { createHash } from 'node:crypto';
import { banco, ErroApi } from '@/lib/db';

export type Chave = { id: string; nome: string; escopos: string[] };

// Confere a chave (só o hash fica no banco) e marca o último uso.
export async function autenticar(texto: string | null | undefined): Promise<Chave> {
  if (!texto) throw new ErroApi(401, 'Falta a chave: envie Authorization: Bearer <chave>.');
  const hash = createHash('sha256').update(texto.trim()).digest('hex');
  const res = await banco().query(
    'update api_chaves set ultimo_uso = now() where hash = $1 and ativa returning id, nome, escopos',
    [hash],
  );
  if (!res.rowCount) throw new ErroApi(401, 'Chave inválida ou desativada.');
  return res.rows[0] as Chave;
}

export function chaveDoCabecalho(h: string | null): string | null {
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}
