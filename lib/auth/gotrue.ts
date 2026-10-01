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

// O Auth fica em outra região: sem limite de espera, um Supabase lento travaria todas as telas.
const ESPERA_MS = 8000;
const limite = () => AbortSignal.timeout(ESPERA_MS);

function lerTokens(j: Partial<Tokens>): Tokens | null {
  if (!j.access_token || !j.refresh_token) return null;
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: Number(j.expires_in) || 3600 };
}

async function token(grant: 'password' | 'refresh_token', corpo: Record<string, string>): Promise<Tokens | null> {
  const { url, chave } = base();
  const r = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: chave, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    cache: 'no-store',
    signal: limite(),
  });
  if (!r.ok) return null;
  return lerTokens((await r.json()) as Partial<Tokens>);
}

export const entrarComSenha = (email: string, senha: string) => token('password', { email, password: senha });

// Primeiro acesso: cria a conta no Supabase Auth. Com confirmação de e-mail ligada no Supabase, volta sem tokens
// (a pessoa confirma pelo e-mail e depois entra); sem confirmação, já volta com a sessão.
export async function criarConta(email: string, senha: string): Promise<{ tokens: Tokens | null; erro: string | null }> {
  const { url, chave } = base();
  const r = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: chave, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: senha }), cache: 'no-store', signal: limite(),
  });
  const j = (await r.json().catch(() => ({}))) as Partial<Tokens> & { msg?: string; error_description?: string; code?: string | number };
  if (!r.ok) return { tokens: null, erro: j.msg || j.error_description || 'Não foi possível criar a senha.' };
  if (j.access_token && j.refresh_token) {
    return { tokens: { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: Number(j.expires_in) || 3600 }, erro: null };
  }
  return { tokens: null, erro: null };
}
export const renovarSessao = (refresh: string) => token('refresh_token', { refresh_token: refresh });

// Confere o token no Supabase Auth (assinatura e validade) e devolve o e-mail e o id do usuário.
// Quem é o dono do token. O Auth fica longe do servidor do painel (outra região), e perguntar a cada clique
// custava ~0,3 s. Guardamos a resposta por até 60 s (nunca além do vencimento do token). O "ativo" da pessoa
// continua sendo conferido no banco a cada pedido (lib/sessao.ts), então desativar alguém vale na hora.
const CACHE_MS = 60_000;
const cacheToken = new Map<string, { u: { id: string; email: string }; ate: number }>();

export async function usuarioDoToken(acesso: string): Promise<{ id: string; email: string } | null> {
  const agora = Date.now();
  const c = cacheToken.get(acesso);
  if (c && c.ate > agora) return c.u;
  const { url, chave } = base();
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: chave, authorization: `Bearer ${acesso}` }, cache: 'no-store', signal: limite() });
  if (!r.ok) { cacheToken.delete(acesso); return null; }
  const j = (await r.json()) as { id?: string; email?: string };
  if (!j.id || !j.email) return null;
  const u = { id: j.id, email: j.email };
  const vence = agora + segundosRestantes(acesso) * 1000;
  if (cacheToken.size > 500) for (const [k, v] of cacheToken) if (v.ate <= agora) cacheToken.delete(k);
  if (cacheToken.size <= 1000) cacheToken.set(acesso, { u, ate: Math.min(agora + CACHE_MS, vence) });
  return u;
}

export async function encerrarSessao(acesso: string): Promise<void> {
  cacheToken.delete(acesso);
  try {
    const { url, chave } = base();
    await fetch(`${url}/auth/v1/logout`, { method: 'POST', headers: { apikey: chave, authorization: `Bearer ${acesso}` }, cache: 'no-store', signal: limite() });
  } catch { /* sair funciona mesmo sem avisar o Auth */ }
}

// ---- Segundo fator (TOTP) do master (decisão 26; auditoria 01/10, S3) ----
// Usa o MFA do próprio Supabase Auth: a sessão sobe de "aal1" (só senha) para "aal2" (senha + código do
// autenticador). O master só entra nas telas com aal2. PAINEL_MFA_MASTER=0 desliga (só para emergência).
export const mfaExigido = () => process.env.PAINEL_MFA_MASTER !== '0';

function claims(acesso: string | undefined): Record<string, unknown> {
  if (!acesso) return {};
  try {
    const parte = acesso.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(parte.padEnd(parte.length + ((4 - (parte.length % 4)) % 4), '=')));
  } catch {
    return {};
  }
}
export const nivelDaSessao = (acesso: string | undefined) => String(claims(acesso).aal ?? 'aal1');

export type Fator = { id: string; factor_type: string; status: string };

async function authPedido(acesso: string, caminho: string, metodo: 'GET' | 'POST' | 'DELETE', corpo?: unknown) {
  const { url, chave } = base();
  const r = await fetch(`${url}/auth/v1${caminho}`, {
    method: metodo, cache: 'no-store', signal: limite(),
    headers: { apikey: chave, authorization: `Bearer ${acesso}`, 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, j };
}

export async function fatoresTotp(acesso: string): Promise<Fator[]> {
  const r = await authPedido(acesso, '/user', 'GET');
  if (!r.ok) return [];
  return ((r.j.factors as Fator[] | undefined) ?? []).filter((f) => f.factor_type === 'totp');
}

// Cadastra um autenticador novo (apaga antes os que ficaram pela metade). Devolve o QR e o segredo para digitar.
export async function inscreverTotp(acesso: string): Promise<{ id: string; qr: string; segredo: string } | null> {
  for (const f of await fatoresTotp(acesso)) if (f.status !== 'verified') await authPedido(acesso, `/factors/${f.id}`, 'DELETE');
  const r = await authPedido(acesso, '/factors', 'POST', { factor_type: 'totp', friendly_name: `Painel Planee ${new Date().toISOString().slice(0, 16)}`, issuer: 'Painel Planee' });
  const totp = r.j.totp as { qr_code?: string; secret?: string } | undefined;
  if (!r.ok || typeof r.j.id !== 'string' || !totp?.qr_code) return null;
  return { id: r.j.id, qr: totp.qr_code, segredo: totp.secret ?? '' };
}

// Desafio + verificação do código de 6 dígitos. Certo: volta a sessão nova (aal2).
export async function verificarTotp(acesso: string, fator: string, codigo: string): Promise<Tokens | null> {
  if (!/^[\w-]{1,64}$/.test(fator)) return null;
  const d = await authPedido(acesso, `/factors/${fator}/challenge`, 'POST', {});
  if (!d.ok || typeof d.j.id !== 'string') return null;
  const v = await authPedido(acesso, `/factors/${fator}/verify`, 'POST', { challenge_id: d.j.id, code: codigo });
  return v.ok ? lerTokens(v.j as Partial<Tokens>) : null;
}

// Segundos até o token vencer, lendo o próprio token (só para decidir quando renovar; a validação é do Auth).
export function segundosRestantes(acesso: string | undefined): number {
  const exp = Number(claims(acesso).exp);
  return Number.isFinite(exp) ? exp - Math.floor(Date.now() / 1000) : -1;
}

export function opcoesCookie(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge };
}
