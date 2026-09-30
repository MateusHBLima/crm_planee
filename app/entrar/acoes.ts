'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { bancoConfigurado, central } from '@/lib/db';
import {
  authConfigurado, COOKIE_ACESSO, COOKIE_RENOVA, criarConta, DIAS_SESSAO, encerrarSessao, entrarComSenha, opcoesCookie,
} from '@/lib/auth/gotrue';

// O destino volta para o navegador, que navega sozinho. Um redirect() aqui seria renderizado pelo Next num
// pedido interno para localhost, sem o endereço da empresa (decisão 26).
export type EstadoEntrar = { erro: string | null; email: string; destino?: string };

function destinoSeguro(v: FormDataEntryValue | null): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/entrar') ? s : '/';
}

export async function entrar(_: EstadoEntrar, form: FormData): Promise<EstadoEntrar> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const senha = String(form.get('senha') ?? '');
  if (!email || !senha) return { erro: 'Preencha o e-mail e a senha.', email };
  if (!authConfigurado() || !bancoConfigurado()) {
    return { erro: 'O login ainda não foi configurado neste endereço. Avise a Planee.', email };
  }
  let tokens = null;
  try { tokens = await entrarComSenha(email, senha); } catch { tokens = null; }
  if (!tokens) return { erro: 'E-mail ou senha incorretos.', email };

  const liberado = await central().query('select 1 from painel_usuarios where lower(email) = $1 and ativo', [email]);
  if (!liberado.rowCount) {
    await encerrarSessao(tokens.access_token);
    return { erro: 'Este e-mail ainda não tem acesso ao painel. Peça para o gestor liberar.', email };
  }
  const c = await cookies();
  c.set(COOKIE_ACESSO, tokens.access_token, opcoesCookie(tokens.expires_in));
  c.set(COOKIE_RENOVA, tokens.refresh_token, opcoesCookie(DIAS_SESSAO * 86400));
  return { erro: null, email, destino: destinoSeguro(form.get('volta')) };
}

export async function sair() {
  const c = await cookies();
  const acesso = c.get(COOKIE_ACESSO)?.value;
  if (acesso) await encerrarSessao(acesso);
  c.delete(COOKIE_ACESSO);
  c.delete(COOKIE_RENOVA);
  redirect('/entrar');
}

export type EstadoPrimeiro = { erro: string | null; email: string; enviado: boolean; destino?: string };

// Primeiro acesso: só para e-mail que a Planee ou o admin já cadastrou e que ainda não entrou nenhuma vez.
export async function criarSenha(_: EstadoPrimeiro, form: FormData): Promise<EstadoPrimeiro> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const senha = String(form.get('senha') ?? '');
  const repete = String(form.get('repete') ?? '');
  const volta = (erro: string) => ({ erro, email, enviado: false });
  if (!email || !senha) return volta('Preencha o e-mail e a senha.');
  if (senha.length < 8) return volta('A senha precisa ter pelo menos 8 caracteres.');
  if (senha !== repete) return volta('As duas senhas não são iguais.');
  if (!authConfigurado() || !bancoConfigurado()) return volta('O login ainda não foi configurado neste endereço. Avise a Planee.');
  const p = await central().query('select auth_id from painel_usuarios where lower(email) = $1 and ativo', [email]);
  if (!p.rowCount) return volta('Este e-mail ainda não foi cadastrado. Peça para o admin da sua empresa adicionar você.');
  if (p.rows[0].auth_id) return volta('Este e-mail já tem senha. Use "Entrar".');
  let r: Awaited<ReturnType<typeof criarConta>>;
  try { r = await criarConta(email, senha); } catch { return volta('Não foi possível criar a senha agora. Tente de novo.'); }
  if (r.erro) return volta(r.erro);
  if (!r.tokens) return { erro: null, email, enviado: true };
  const c = await cookies();
  c.set(COOKIE_ACESSO, r.tokens.access_token, opcoesCookie(r.tokens.expires_in));
  c.set(COOKIE_RENOVA, r.tokens.refresh_token, opcoesCookie(DIAS_SESSAO * 86400));
  return { erro: null, email, enviado: false, destino: '/' };
}
