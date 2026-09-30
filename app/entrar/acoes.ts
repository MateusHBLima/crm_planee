'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { banco, bancoConfigurado } from '@/lib/db';
import {
  authConfigurado, COOKIE_ACESSO, COOKIE_RENOVA, DIAS_SESSAO, encerrarSessao, entrarComSenha, opcoesCookie,
} from '@/lib/auth/gotrue';

export type EstadoEntrar = { erro: string | null; email: string };

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

  const liberado = await banco().query('select 1 from painel_usuarios where lower(email) = $1 and ativo', [email]);
  if (!liberado.rowCount) {
    await encerrarSessao(tokens.access_token);
    return { erro: 'Este e-mail ainda não tem acesso ao painel. Peça para o gestor liberar.', email };
  }
  const c = await cookies();
  c.set(COOKIE_ACESSO, tokens.access_token, opcoesCookie(tokens.expires_in));
  c.set(COOKIE_RENOVA, tokens.refresh_token, opcoesCookie(DIAS_SESSAO * 86400));
  redirect(destinoSeguro(form.get('volta')));
}

export async function sair() {
  const c = await cookies();
  const acesso = c.get(COOKIE_ACESSO)?.value;
  if (acesso) await encerrarSessao(acesso);
  c.delete(COOKIE_ACESSO);
  c.delete(COOKIE_RENOVA);
  redirect('/entrar');
}
