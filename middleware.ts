import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_MODO, modoDoHost, type Modo } from './lib/modo';

export function middleware(req: NextRequest) {
  const host = req.headers.get('host');
  const pedido = req.nextUrl.searchParams.get('modo');
  let modo: Modo = modoDoHost(host) ?? (req.cookies.get(COOKIE_MODO)?.value === 'adm' ? 'adm' : 'cliente');
  const trocar = !modoDoHost(host) && (pedido === 'adm' || pedido === 'cliente');
  if (trocar) modo = pedido as Modo;

  const headers = new Headers(req.headers);
  headers.set('x-modo', modo);
  const res = NextResponse.next({ request: { headers } });
  if (trocar) res.cookies.set(COOKIE_MODO, modo, { path: '/', sameSite: 'lax' });
  return res;
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico).*)'],
};
