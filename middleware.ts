import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_ACESSO, COOKIE_RENOVA, DIAS_SESSAO, opcoesCookie, renovarSessao, segundosRestantes } from '@/lib/auth/gotrue';

// Toda tela do painel exige login. A API (/api/v1, /api/mcp) usa chave própria e fica de fora,
// assim como /api/saude (verificação do Docker).
// Aqui só se garante que existe sessão e que o token está em dia; quem é a pessoa e o papel dela
// são conferidos no servidor de cada tela (lib/sessao.ts).
export async function middleware(req: NextRequest) {
  const acesso = req.cookies.get(COOKIE_ACESSO)?.value;
  const renova = req.cookies.get(COOKIE_RENOVA)?.value;

  const paraEntrar = () => {
    const u = req.nextUrl.clone();
    const volta = req.nextUrl.pathname + req.nextUrl.search;
    u.pathname = '/entrar';
    u.search = volta && volta !== '/' ? `?volta=${encodeURIComponent(volta)}` : '';
    const r = NextResponse.redirect(u);
    r.cookies.delete(COOKIE_ACESSO);
    r.cookies.delete(COOKIE_RENOVA);
    return r;
  };

  if (!renova) return paraEntrar();
  if (acesso && segundosRestantes(acesso) > 60) return NextResponse.next();

  let novos = null;
  try { novos = await renovarSessao(renova); } catch { novos = null; }
  if (!novos) {
    // Duas abas ou requisições renovando juntas: se o token atual ainda vale, segue com ele.
    if (acesso && segundosRestantes(acesso) > 5) return NextResponse.next();
    return paraEntrar();
  }

  // Passa os tokens novos para esta mesma requisição e grava no navegador.
  req.cookies.set(COOKIE_ACESSO, novos.access_token);
  req.cookies.set(COOKIE_RENOVA, novos.refresh_token);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(COOKIE_ACESSO, novos.access_token, opcoesCookie(novos.expires_in));
  res.cookies.set(COOKIE_RENOVA, novos.refresh_token, opcoesCookie(DIAS_SESSAO * 86400));
  return res;
}

export const config = {
  matcher: ['/((?!entrar|api/v1|api/mcp|api/saude|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
