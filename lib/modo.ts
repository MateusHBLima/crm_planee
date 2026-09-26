// Decisões 12 e 19: o endereço acessado decide o modo.
// adm.planeelabia.com -> modo Planee; painel.<cliente>.planeelabia.com -> modo cliente.
// No endereço grátis (.vercel.app) e em localhost, ?modo=adm ou ?modo=cliente troca o modo (fica salvo em cookie).

export type Modo = 'adm' | 'cliente';

export const COOKIE_MODO = 'modo_preview';

export function modoDoHost(host: string | null | undefined): Modo | null {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0];
  if (h.startsWith('adm.')) return 'adm';
  if (h.startsWith('painel.')) return 'cliente';
  return null; // .vercel.app, localhost: decide pelo cookie de pré-visualização
}

// painel.ssa.planeelabia.com -> "ssa"
export function clienteDoHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const partes = host.toLowerCase().split(':')[0].split('.');
  if (partes[0] === 'painel' && partes.length > 3) return partes[1];
  return null;
}
