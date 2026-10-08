import { NextResponse, type NextRequest } from 'next/server';
import { esquecerSessoes, usuarioAtual } from '@/lib/sessao';
import { COOKIE_EMPRESA } from '@/lib/empresa';

export const dynamic = 'force-dynamic';

// GET /ir?empresa=<id>&para=/inbox?numero=..&wa=.. — entra na empresa e abre a tela pedida (links do Interno Planee:
// "abrir a conversa" e "abrir o cartão" de um aviso). Só para quem tem acesso à empresa; no domínio de uma empresa,
// ela é fixa e o link só vale para ela. O destino é sempre uma tela do painel (nunca outro site).
const DESTINO = /^\/(inbox|crm)(\?[A-Za-z0-9=&%._-]*)?$/;

export async function GET(req: NextRequest) {
  const u = await usuarioAtual();
  const base = req.nextUrl.clone();
  base.search = '';
  if (!u) { base.pathname = '/entrar'; return NextResponse.redirect(base); }
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const para = req.nextUrl.searchParams.get('para') ?? '';
  const destino = DESTINO.test(para) ? para : '/';
  const pode = u.empresaFixa ? u.empresa?.id === empresa : u.empresas.some((e) => e.id === empresa);
  if (!pode) { base.pathname = '/'; return NextResponse.redirect(base); }
  const alvo = req.nextUrl.clone();
  const [caminho, busca] = destino.split('?');
  alvo.pathname = caminho; alvo.search = busca ? `?${busca}` : '';
  const r = NextResponse.redirect(alvo);
  if (!u.empresaFixa) {
    r.cookies.set(COOKIE_EMPRESA, empresa, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 90 });
  }
  esquecerSessoes();
  return r;
}
