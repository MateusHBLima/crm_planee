import { redirect } from 'next/navigation';
import { exigirUsuario } from '@/lib/sessao';
import { telasDe } from '@/lib/telas';

// Enquanto a inbox (1.1) não existe, abre direto no CRM (ou na primeira tela que a pessoa pode ver).
export default async function Inicio() {
  const u = await exigirUsuario();
  const telas = telasDe(u);
  if (!telas.length) redirect('/entrar?motivo=semtelas');
  redirect(`/${(telas.find((t) => t.id === 'crm') ?? telas[0]).id}`);
}
