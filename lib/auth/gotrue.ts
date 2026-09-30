// Chamadas ao Supabase Auth do projeto (sem biblioteca: roda no middleware e no servidor).
// Variáveis do deploy, só do servidor: SUPABASE_URL e SUPABASE_ANON_KEY.

export const COOKIE_ACESSO = 'pp_at';
export const COOKIE_RENOVA = 'pp_rt';
export const DIAS_SESSAO = 30;

export type Tokens = { access_token: string; refresh_token: string; expires_in: number };

export function authConfigurado(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function base(): { url: string; chave: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const chave = process.env.SUPABASE_ANON_KEY;
  if (!url || !chave) throw new Error('Login não configurado: faltam SUPABASE_URL e SUPABASE_ANON_KEY neste deploy.');
  return { url, chave };
}

async function token(grant: 'password' | 'refresh_token', corpo: Record<string, string>): Promise<Tokens | null> {
  const { url, chave } = base();
  const r = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: chave, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const j = (await r.json()) as Partial<Tokens>;
  if (!j.access_token || !j.refresh_token) return null;
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: Number(j.expires_in) || 3600 };
}

export const entrarComSenha = (email: string, senha: string) => token('password', { email, password: senha });
export const renovarSessao = (refresh: string) => token('refresh_token', { refresh_token: refresh });

// Confere o token no Supabase Auth (assinatura e validade) e devolve o e-mail e o id do usuário.
export async function usuarioDoToken(acesso: string): Promise<{ id: string; email: string } | null> {
  const { url, chave } = base();
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: chave, authorization: `Bearer ${acesso}` }, cache: 'no-store' });
  if (!r.ok) return null;
  const j = (await r.json()) as { id?: string; email?: string };
  return j.id && j.email ? { id: j.id, email: j.email } : null;
}

export async function encerrarSessao(acesso: string): Promise<void> {
  try {
    const { url, chave } = base();
    await fetch(`${url}/auth/v1/logout`, { method: 'POST', headers: { apikey: chave, authorization: `Bearer ${acesso}` }, cache: 'no-store' });
  } catch { /* sair funciona mesmo sem avisar o Auth */ }
}

// Segundos até o token vencer, lendo o próprio token (só para decidir quando renovar; a validação é do Auth).
export function segundosRestantes(acesso: string | undefined): number {
  if (!acesso) return -1;
  try {
    const parte = acesso.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = Number(JSON.parse(atob(parte.padEnd(parte.length + ((4 - (parte.length % 4)) % 4), '='))).exp);
    return exp - Math.floor(Date.now() / 1000);
  } catch {
    return -1;
  }
}

export function opcoesCookie(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge };
}
