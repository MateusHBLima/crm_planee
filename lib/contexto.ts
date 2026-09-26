import { clienteDoDeploy, modoDoDeploy, type Modo } from './modo';

export async function contexto(): Promise<{ modo: Modo; cliente: string | null }> {
  return { modo: modoDoDeploy(), cliente: clienteDoDeploy() };
}
