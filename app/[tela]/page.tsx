import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Shell } from '@/components/Shell';
import { CrmTela } from '@/components/crm/CrmTela';
import { InboxTela } from '@/components/inbox/InboxTela';
import { Empresas } from '@/components/gestao/Empresas';
import { Equipe } from '@/components/gestao/Equipe';
import { exigirUsuario, pode, podeArquivar } from '@/lib/sessao';
import { hostDeCabecalhos } from '@/lib/empresa';
import { lerConfigCrm } from '@/lib/painel/crm';
import { ConfigCrm } from '@/components/crm/ConfigCrm';
import { Interno } from '@/components/planee/Interno';
import { PlaneeEmpresa } from '@/components/planee/PlaneeEmpresa';
import { listarEmpresas, listarEquipe } from '@/lib/painel/gestao';
import { IDS_TELAS, telasDe } from '@/lib/telas';
import { ErroApi } from '@/lib/db';
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

  // Empresa sem banco configurado (ou banco fora do ar): mensagem clara em vez da página de erro genérica.
  const aviso = (texto: string) => (
    <Shell atual={atual.id} usuario={usuario}>
      <p className={p.rotulo}>{usuario.empresa?.nome ?? 'Planee'}</p>
      <h1 className={p.titulo}>{atual.nome}</h1>
      <div className={p.cartao} role="alert"><p className={p.texto}>{texto}</p></div>
    </Shell>
  );
  const tentar = async <T,>(fn: () => Promise<T>): Promise<T | { erro: string }> => {
    try { return await fn(); } catch (e) { if (e instanceof ErroApi) return { erro: e.message }; throw e; }
  };

  // Inbox e CRM abrem sem esperar o banco (09/10): o servidor manda a tela na hora e os dados chegam pela leitura GET
  // (ou da memória da aba, quando a pessoa volta). O banco da clínica fica em outra região; esperar aqui segurava a
  // troca de tela por 1 a 2 s. Empresa sem banco: o erro aparece na própria tela, com o mesmo texto de antes.
  if (atual.id === 'inbox' && usuario.empresa) {
    return (
      <Shell atual={atual.id} usuario={usuario} largo>
        <InboxTela key={usuario.empresa.id} empresaId={usuario.empresa.id} mascarado={usuario.master} podeResponder={pode(usuario, 'inbox.responder')} nome={usuario.nome} />
      </Shell>
    );
  }

  if (atual.id === 'crm' && usuario.empresa) {
    return (
      <Shell atual={atual.id} usuario={usuario} largo>
        <CrmTela key={usuario.empresa.id} empresaId={usuario.empresa.id} podeArquivar={podeArquivar(usuario)} podeEditar={pode(usuario, 'crm.editar')}
          podeConfig={pode(usuario, 'crm.config')} podeConferir={pode(usuario, 'pagamentos.conferir')} mascarado={usuario.master} nome={usuario.nome} />
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
    const config = await tentar(() => lerConfigCrm(usuario));
    if ('erro' in config) return aviso(config.erro);
    return (
      <Shell atual={atual.id} usuario={usuario} largo>
        <ConfigCrm key={usuario.empresa.id} inicial={config} />
      </Shell>
    );
  }

  // Interno Planee (master): fila de avisos, saúde, novidades e integrações. Os dados vêm pelas leituras GET.
  if (atual.id === 'interno') {
    return (
      <Shell atual={atual.id} usuario={usuario}>
        <Interno empresas={usuario.empresas} nome={usuario.nome} />
      </Shell>
    );
  }

  // Tela "Planee" da empresa: avisos que a equipe mandou, respostas, novidades e manutenção.
  if (atual.id === 'planee' && usuario.empresa) {
    return (
      <Shell atual={atual.id} usuario={usuario}>
        <PlaneeEmpresa key={usuario.empresa.id} empresa={usuario.empresa.nome} />
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
        <p className={p.dica}>Esta tela ainda está em construção. A inbox e o CRM já funcionam.</p>
      </div>
    </Shell>
  );
}
