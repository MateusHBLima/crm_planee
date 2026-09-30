import { redirect } from 'next/navigation';
import { contexto } from '@/lib/contexto';
import { exigirUsuario } from '@/lib/sessao';
import { telasDo } from '@/lib/telas';

// Enquanto a inbox (1.1) não existe, o modo cliente abre direto no CRM.
export default async function Inicio() {
  const { modo } = await contexto();
  const u = await exigirUsuario();
  const telas = telasDo(modo, u.papel);
  redirect(`/${(telas.find((t) => t.id === 'crm') ?? telas[0]).id}`);
}
