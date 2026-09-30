import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Shell } from '@/components/Shell';
import { Crm } from '@/components/crm/Crm';
import { Empresas } from '@/components/gestao/Empresas';
import { Equipe } from '@/components/gestao/Equipe';
import { exigirUsuario, pode, podeArquivar } from '@/lib/sessao';
import { hostDeCabecalhos } from '@/lib/empresa';
import { lerConfigCrm, lerQuadro } from '@/lib/painel/crm';
import { ConfigCrm } from '@/components/crm/ConfigCrm';
import { listarEmpresas, listarEquipe } from '@/lib/painel/gestao';
import { IDS_TELAS, telasDe } from '@/lib/telas';
import p from '../pagina.module.css';

export const dynamic = 'force-dynamic';

export default async function PaginaTela({ params }: { params: Promise<{ tela: string }> }) {
  const { tela } = await params;
  const usuario = await exigirUsuario();
  const telas = telasDe(usuario);
  const atual = telas.find((t) => t.id === tela);
  if (!atual) {
    // Tela que existe mas não é desta pessoa (ou desta empresa): volta para a primeira que ela pode ver.
    if (IDS_TELAS.includes(tela)) redirect(telas.length ? `/${telas[0].id}` : '/entrar?motivo=semtelas');
    notFound();
  }

  if (atual.id === 'crm') {
    const quadro = await lerQuadro(usuario);
    return (
      <Shell atual={atual.id} usuario={usuario} largo>
        <Crm key={usuario.empresa?.id} inicial={quadro} podeArquivar={podeArquivar(usuario)} podeEditar={pode(usuario, 'crm.editar')}
          podeConfig={pode(usuario, 'crm.config')} mascarado={usuario.master} nome={usuario.nome} />
      </Shell>
    );
  }

  if (atual.id === 'equipe' && usuario.empresa) {
    const pessoas = await listarEquipe(usuario);
    const endereco = hostDeCabecalhos(await headers()) ?? 'o endereço do painel';
    return (
      <Shell atual={atual.id} usuario={usuario}>
        <Equipe key={usuario.empresa.id} inicial={pessoas} souMaster={usuario.nivel === 'master'} meuId={usuario.id} endereco={endereco}
          empresa={{ id: usuario.empresa.id, nome: usuario.empresa.nome, modulos: usuario.empresa.modulos }} />
      </Shell>
    );
  }

  if (atual.id === 'configuracoes' && usuario.empresa && pode(usuario, 'crm.config')) {
    return (
      <Shell atual={atual.id} usuario={usuario} largo>
        <ConfigCrm key={usuario.empresa.id} inicial={await lerConfigCrm(usuario)} />
      </Shell>
    );
  }

  if (atual.id === 'empresas') {
    return (
      <Shell atual={atual.id} usuario={usuario}>
        <Empresas inicial={await listarEmpresas(usuario)} />
      </Shell>
    );
  }

  return (
    <Shell atual={atual.id} usuario={usuario}>
      <p className={p.rotulo}>{usuario.empresa?.nome ?? 'Planee'}</p>
      <h1 className={p.titulo}>{atual.nome}</h1>
      <div className={p.cartao}>
        <p className={p.texto}>{atual.descricao}</p>
        <p className={p.dica}>Esta tela ainda está em construção. O CRM já funciona.</p>
      </div>
    </Shell>
  );
}
