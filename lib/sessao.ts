import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { banco, bancoConfigurado } from '@/lib/db';
import { COOKIE_ACESSO, usuarioDoToken } from '@/lib/auth/gotrue';
import type { Chave } from '@/lib/api/auth';

export type Papel = 'secretaria' | 'gestor' | 'planee';
export type Usuario = { id: string; nome: string; email: string; papel: Papel };

// Quem está usando o painel nesta requisição. null = sem sessão válida ou sem acesso liberado.
export const usuarioAtual = cache(async (): Promise<Usuario | null> => {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso || !bancoConfigurado()) return null;
  let auth: { id: string; email: string } | null = null;
  try { auth = await usuarioDoToken(acesso); } catch { auth = null; }
  if (!auth) return null;
  const r = await banco().query(
    `update painel_usuarios set auth_id = coalesce(auth_id, $2), ultimo_acesso = now()
      where lower(email) = lower($1) and ativo and (auth_id is null or auth_id = $2)
      returning id, nome, email, papel`,
    [auth.email, auth.id],
  );
  return r.rowCount ? (r.rows[0] as Usuario) : null;
});

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect('/entrar?motivo=sessao');
  return u;
}

// O que cada papel pode fazer pela API interna (mesmas regras de escopo das chaves).
const ESCOPOS: Record<Papel, string[]> = {
  secretaria: ['leitura', 'crm'],
  gestor: ['leitura', 'crm', 'config'],
  planee: ['leitura', 'crm', 'config'],
};

export function atorDe(u: Usuario): Chave {
  return { id: null, nome: u.nome, escopos: ESCOPOS[u.papel], usuario_id: u.id };
}

export const podeArquivar = (u: Usuario) => u.papel !== 'secretaria';
