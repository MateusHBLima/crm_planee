import 'server-only';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { bancoDaEmpresa, ErroApi, type RefEmpresa } from '@/lib/db';
import { empresaDoDominio } from '@/lib/empresa';

// Quem faz a operação: uma chave da API (id) ou uma pessoa logada no painel (usuario_id),
// sempre dentro de uma empresa (o banco de dados dela). empresa null = banco padrão do deploy.
export type Chave = {
  id: string | null; nome: string; escopos: string[]; usuario_id?: string | null; empresa?: RefEmpresa | null;
};

export const bancoDe = (c: Chave): Pool => bancoDaEmpresa(c.empresa ?? null);

// Confere a chave (só o hash fica no banco) e marca o último uso. A chave vale no banco da empresa
// dona do endereço chamado; em endereço geral (adm, link de teste), no banco padrão do deploy.
export async function autenticar(texto: string | null | undefined, host?: string | null): Promise<Chave> {
  if (!texto) throw new ErroApi(401, 'Falta a chave: envie Authorization: Bearer <chave>.');
  const empresa = await empresaDoDominio(host ?? null);
  if (empresa && !empresa.ativo) throw new ErroApi(403, 'Esta empresa está desativada no painel.');
  const hash = createHash('sha256').update(texto.trim()).digest('hex');
  const res = await bancoDaEmpresa(empresa).query(
    'update api_chaves set ultimo_uso = now() where hash = $1 and ativa returning id, nome, escopos',
    [hash],
  );
  if (!res.rowCount) throw new ErroApi(401, 'Chave inválida ou desativada.');
  return { ...(res.rows[0] as Chave), empresa: empresa ? { id: empresa.id, banco_url_cifrado: empresa.banco_url_cifrado } : null };
}

export function chaveDoCabecalho(h: string | null): string | null {
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}
