// Catálogo do que a API deixa criar e editar (decisão 25).
// Acrescentar um recurso novo é acrescentar uma entrada aqui (e a tabela na migração).

export type Escopo = 'leitura' | 'crm' | 'config';

export type Recurso = {
  nome: string;
  tabela: string;
  descricao: string;
  chave: 'id';
  idTipo: 'texto' | 'uuid';
  idObrigatorioNaCriacao: boolean; // true quando o id é escolhido por quem cria (ex.: "receita")
  escrita: Escopo;
  campos: Record<string, string>; // campo editável -> descrição
  filtros: string[];
  ordem: string;
};

export const RECURSOS: Record<string, Recurso> = {
  etapas: {
    nome: 'etapas', tabela: 'crm_etapas', chave: 'id', idTipo: 'texto', idObrigatorioNaCriacao: true, escrita: 'config',
    descricao: 'Etapas do funil comercial. Precisa existir ao menos uma de cada tipo (aberta, ganho, perdido).',
    campos: {
      ordem: 'número da posição no funil',
      nome: 'nome exibido',
      tipo: 'aberta | ganho | perdido',
      gatilho: 'evento que move o cartão para cá, ou "Manual (equipe)"',
    },
    filtros: ['tipo', 'arquivado'], ordem: 'ordem, nome',
  },
  topicos: {
    nome: 'topicos', tabela: 'crm_topicos', chave: 'id', idTipo: 'texto', idObrigatorioNaCriacao: true, escrita: 'config',
    descricao: 'Assuntos do quadro de atendimento (colunas). Sem cor: ícone e nome.',
    campos: {
      ordem: 'número da posição',
      nome: 'nome exibido',
      icone: 'receita | doc | exame | valor | agenda | os | garantia | caixa | recibo | pessoa | predio | outros',
      palavras: 'palavras que a IA usa para classificar, separadas por vírgula',
    },
    filtros: ['arquivado'], ordem: 'ordem, nome',
  },
  contatos: {
    nome: 'contatos', tabela: 'contatos', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
    descricao: 'Pacientes ou clientes. Telefone no formato 55 + DDD + número, só dígitos.',
    campos: {
      nome: 'nome da pessoa',
      telefone: 'só dígitos, com 55',
      documento: 'CPF ou CNPJ, só dígitos',
      tipo_documento: 'cpf | cnpj',
      empresa: 'empresa, quando for cliente PJ',
    },
    filtros: ['telefone', 'documento', 'arquivado'], ordem: 'criado_em desc',
  },
  oportunidades: {
    nome: 'oportunidades', tabela: 'oportunidades', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
    descricao: 'Cartões do funil comercial. Mover de etapa = atualizar etapa_id.',
    campos: {
      contato_id: 'id do contato',
      interesse: 'o que a pessoa quer',
      etapa_id: 'id de uma etapa existente',
      valor: 'valor estimado em reais',
    },
    filtros: ['contato_id', 'etapa_id', 'arquivado'], ordem: 'atualizado_em desc',
  },
  atendimentos: {
    nome: 'atendimentos', tabela: 'atendimentos', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
    descricao: 'Solicitações do quadro de atendimento. Mover = atualizar etapa; finalizar = etapa "finalizado".',
    campos: {
      contato_id: 'id do contato',
      topico_id: 'id de um assunto existente',
      etapa: 'aguardando | em_atendimento | pendente | finalizado',
      resumo: 'o que foi pedido',
      aberto_por: 'IA ou nome de quem abriu',
      responsavel: 'nome de quem está atendendo',
      oportunidade_id: 'id da oportunidade ligada, se houver',
    },
    filtros: ['contato_id', 'topico_id', 'etapa', 'responsavel', 'arquivado'], ordem: 'atualizado_em desc',
  },
  notas: {
    nome: 'notas', tabela: 'notas', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
    descricao: 'Notas internas em contatos, oportunidades ou atendimentos.',
    campos: {
      alvo_tipo: 'contatos | oportunidades | atendimentos',
      alvo_id: 'id do registro',
      texto: 'conteúdo da nota',
      autor: 'quem escreveu',
    },
    filtros: ['alvo_tipo', 'alvo_id', 'arquivado'], ordem: 'criado_em desc',
  },
};

// Serviços e pagamentos (migração 013). Pagamento com arquivo e análise passa por funções próprias
// (lib/api/servico.ts: criarPagamento e atualizarPagamento), que abrem o alerta de comprovante suspeito.
Object.assign(RECURSOS, {
  servicos: {
    nome: 'servicos', tabela: 'servicos', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
    descricao: 'O que está sendo pago: na clínica, cada agendamento (Feegow). Para criar ou atualizar pelo código do sistema, use POST /api/v1/servicos/registrar.',
    campos: {
      contato_id: 'id do contato',
      tipo: 'Consulta, Retorno, Exame, OS…',
      descricao: 'detalhe do serviço',
      inicio: 'data e hora (ISO)',
      profissional: 'quem atende',
      local: 'onde (ou "Online")',
      valor: 'valor em reais',
      situacao: 'agendado | confirmado | realizado | cancelado | faltou',
      sistema: 'de onde vem o código (ex.: feegow)',
      codigo_externo: 'id no sistema da empresa',
      detalhes: 'objeto livre com o resto (aparece no painel)',
      atendimento_id: 'cartão do quadro ligado, se houver',
      criado_por: 'IA ou nome de quem registrou',
    },
    filtros: ['contato_id', 'situacao', 'sistema', 'codigo_externo', 'arquivado'], ordem: 'inicio desc nulls last, criado_em desc',
  },
  pagamentos: {
    nome: 'pagamentos', tabela: 'pagamentos', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
    descricao: 'Comprovantes de pagamento de um serviço (ou só do contato). O arquivo vai em "arquivo" {nome, mime, base64} e sai em GET /api/v1/pagamentos/{id}/arquivo. "analise" {resultado: ok|suspeito, motivos[]} com suspeito abre um cartão de alerta no quadro. "comprovante" {pagador, banco, id_pix, recebedor, recebedor_documento, emitido_em} guarda o que está escrito nele (migração 014); o mesmo id_pix em outro contato ou agendamento marca suspeito sozinho.',
    campos: {
      contato_id: 'id do contato (ou mande "telefone")',
      servico_id: 'id do serviço (ou mande "servico": {sistema, codigo_externo})',
      atendimento_id: 'cartão do quadro ligado, se houver',
      valor: 'valor pago em reais',
      pago_em: 'data e hora do pagamento (ISO)',
      forma: 'pix | cartao | boleto | dinheiro | outro',
      descricao: 'a que se refere (ex.: sinal da consulta de 14/10)',
      wamid: 'mensagem do WhatsApp em que veio',
      comprovante: '{pagador, banco, id_pix, recebedor, recebedor_documento, emitido_em}: o que está escrito no comprovante (migração 014)',
      criado_por: 'IA ou nome de quem anexou',
    },
    filtros: ['contato_id', 'servico_id', 'analise', 'arquivado'], ordem: 'criado_em desc',
  },
} satisfies Record<string, Recurso>);

export function recurso(nome: string): Recurso | undefined {
  return Object.prototype.hasOwnProperty.call(RECURSOS, nome) ? RECURSOS[nome] : undefined;
}

// Descrição para quem usa a API (pessoa ou IA).
export function catalogo() {
  return {
    api: 'Painel Planee — API do CRM',
    versao: 'v1',
    autenticacao: 'Cabeçalho Authorization: Bearer <chave>. Escopos: leitura, crm, config.',
    regras: [
      'Nada é apagado de vez: "arquivar" marca arquivado = true.',
      'Mensagens de WhatsApp não são enviadas por esta API (passam pelo n8n).',
      'Toda escrita fica registrada em painel_auditoria.',
    ],
    para_a_ia: [
      'GET /api/v1/ficha?telefone=55... — ficha completa do telefone (contatos, atendimentos, notas, oportunidades, etapas do funil). Escopo leitura.',
      'POST /api/v1/funil {"telefone","etapa_id","interesse"?,"valor"?,"nome"?} — move a oportunidade em aberto do telefone para a etapa (ou cria). Escopo crm.',
      'POST /api/v1/servicos/registrar {"telefone","tipo","inicio","sistema","codigo_externo",...} — cria ou atualiza o agendamento pelo código do sistema. Escopo crm.',
      'POST /api/v1/pagamentos {"telefone","servico"?:{sistema,codigo_externo},"valor","pago_em","arquivo":{nome,mime,base64},"wamid"?,"analise"?,"comprovante"?:{pagador,banco,id_pix,recebedor,recebedor_documento,emitido_em}} — anexa o comprovante. Mesmo wamid (ou mesmo id_pix para o mesmo contato e agendamento) devolve o que já existe com repetido=true. id_pix já usado por outro contato ou agendamento marca suspeito e abre o alerta. Escopo crm.',
      'PATCH /api/v1/pagamentos/{id} {"analise":{"resultado":"ok|suspeito","motivos":[...]}} — resultado da análise; suspeito abre o alerta. Escopo crm.',
    ],
    recursos: Object.values(RECURSOS).map((r) => ({
      nome: r.nome,
      descricao: r.descricao,
      escopo_escrita: r.escrita,
      id: r.idObrigatorioNaCriacao ? 'texto escolhido na criação (ex.: "receita")' : 'uuid gerado',
      campos: r.campos,
      filtros: r.filtros,
      rotas: [
        `GET /api/v1/${r.nome}`,
        `POST /api/v1/${r.nome}`,
        `GET /api/v1/${r.nome}/{id}`,
        `PATCH /api/v1/${r.nome}/{id}`,
        `DELETE /api/v1/${r.nome}/{id} (arquiva)`,
      ],
    })),
    config: {
      descricao: 'Configuração livre do CRM (chave -> valor JSON). Ex.: termo_contato, etapas_atendimento, campos_cartao.',
      rotas: ['GET /api/v1/config', 'GET /api/v1/config/{chave}', 'PUT /api/v1/config/{chave} (corpo: {"valor": ...})'],
      escopo_escrita: 'config',
    },
  };
}
