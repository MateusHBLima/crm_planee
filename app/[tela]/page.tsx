import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Crm } from '@/components/crm/Crm';
import { contexto } from '@/lib/contexto';
import { exigirUsuario } from '@/lib/sessao';
import { lerQuadro } from '@/lib/painel/crm';
import { telasDo } from '@/lib/telas';
import p from '../pagina.module.css';

export const dynamic = 'force-dynamic';

export default async function PaginaTela({ params }: { params: Promise<{ tela: string }> }) {
  const { tela } = await params;
  const { modo, cliente } = await contexto();
  const usuario = await exigirUsuario();
  const telas = telasDo(modo, usuario.papel);
  const atual = telas.find((t) => t.id === tela);
  if (!atual) {
    // Tela do outro modo ou fora do papel desta pessoa: volta para a primeira tela que ela pode ver.
    if (telasDo('cliente').some((t) => t.id === tela) || telasDo('adm').some((t) => t.id === tela)) redirect(`/${telas[0].id}`);
    notFound();
  }

  if (atual.id === 'crm') {
    const quadro = await lerQuadro(usuario);
    return (
      <Shell modo={modo} atual={atual.id} cliente={cliente} usuario={usuario} largo>
        <Crm inicial={quadro} papel={usuario.papel} nome={usuario.nome} />
      </Shell>
    );
  }

  return (
    <Shell modo={modo} atual={atual.id} cliente={cliente} usuario={usuario}>
      <p className={p.rotulo}>{modo === 'adm' ? 'Modo Planee' : 'Modo cliente'}</p>
      <h1 className={p.titulo}>{atual.nome}</h1>
      <div className={p.cartao}>
        <p className={p.texto}>{atual.descricao}</p>
        <p className={p.dica}>Esta tela ainda está em construção. O CRM já funciona.</p>
      </div>
    </Shell>
  );
}
