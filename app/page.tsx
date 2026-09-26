import { redirect } from 'next/navigation';
import { contexto } from '@/lib/contexto';
import { telasDo } from '@/lib/telas';

export default async function Inicio() {
  const { modo } = await contexto();
  redirect(`/${telasDo(modo)[0].id}`);
}
