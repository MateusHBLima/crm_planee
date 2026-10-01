// Para onde voltar depois do login. Só caminhos deste mesmo endereço: "/\evil.com", "/%09/evil.com" e
// parecidos viram "//evil.com" no navegador e levariam a pessoa para outro site (redirecionamento aberto).
export function destinoSeguro(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\s\x00-\x1f\x7f]/.test(s)) return '/';
  try {
    const u = new URL(s, 'http://painel.local');
    if (u.origin !== 'http://painel.local' || u.pathname.startsWith('/entrar')) return '/';
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}
