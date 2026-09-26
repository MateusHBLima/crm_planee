import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { contexto } from '@/lib/contexto';
import { telasDo } from '@/lib/telas';
import p from '../pagina.module.css';

export default async function PaginaTela({ params }: { params: Promise<{ tela: string }> }) {
  const { tela } = await params;
  const { modo, cliente } = await contexto();
  const telas = telasDo(modo);
  const atual = telas.find((t) => t.id === tela);
  if (!atual) {
    // Tela do outro modo (ex.: /inbox aberto no deploy adm): volta para a primeira tela deste modo.
    if (telasDo(modo === 'adm' ? 'cliente' : 'adm').some((t) => t.id === tela)) redirect(`/${telas[0].id}`);
    notFound();
  }
  return (
    <Shell modo={modo} atual={atual.id} cliente={cliente}>
      <p className={p.rotulo}>{modo === 'adm' ? 'Modo Planee' : 'Modo cliente'}</p>
      <h1 className={p.titulo}>{atual.nome}</h1>
      <div className={p.cartao}>
        <p className={p.texto}>{atual.descricao}</p>
        <p className={p.dica}>
          Esqueleto da tarefa 0.2. Este deploy está no modo {modo === 'adm' ? 'Planee' : 'cliente'}, definido pela variável{' '}
          <span className={p.mono}>PAINEL_MODO</span> do projeto na Vercel.
        </p>
      </div>
    </Shell>
  );
}
