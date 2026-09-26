import { headers } from 'next/headers';
import { clienteDoHost, type Modo } from './modo';

export async function contexto(): Promise<{ modo: Modo; cliente: string | null }> {
  const h = await headers();
  const modo: Modo = h.get('x-modo') === 'adm' ? 'adm' : 'cliente';
  return { modo, cliente: clienteDoHost(h.get('host')) };
}
