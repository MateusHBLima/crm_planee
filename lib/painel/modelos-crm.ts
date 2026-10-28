// Modelos prontos de CRM para empresa nova (tela Empresas → "Nova empresa", 28/10). Genéricos de propósito (regra 9):
// nada de nome de cliente. Os mesmos três da skill de cadastro (clínica, assistência técnica, contabilidade). Os ids
// das etapas se repetem entre os modelos (novo, contato, ..., perdido), para o funil automático e a IA usarem os
// mesmos nomes em qualquer empresa. Depois de aplicado, tudo se ajusta pela tela Configurações ou pela API.
import type { Permissao } from '@/lib/permissoes';

export type IdModelo = 'clinica' | 'assistencia' | 'contabilidade';

type Etapa = { id: string; ordem: number; nome: string; tipo: 'aberta' | 'ganho' | 'perdido'; gatilho: string };
type Topico = { id: string; ordem: number; nome: string; icone: string; palavras: string };
export type ModeloCrm = {
  id: IdModelo; nome: string; descricao: string; termo: 'paciente' | 'cliente';
  etapas: Etapa[]; topicos: Topico[]; config: Record<string, unknown>;
  permissoes: Permissao[];   // o que a empresa recebe liberado (o admin distribui para a equipe)
};

const ETAPAS_ATENDIMENTO = { aguardando: 'Aguardando equipe', em_atendimento: 'Em atendimento', pendente: 'Pendente interno', finalizado: 'Finalizado' };
const CAMPOS_CARTAO = { responsavel: true, vistas: true, documento: true, funil: true };
const MANUAL = 'Manual (equipe)';

// Inbox e CRM para todo modelo. Agendamentos e comprovantes de pagamento só na clínica (é onde a IA registra).
const BASE: Permissao[] = ['inbox.ver', 'inbox.responder', 'crm.ver', 'crm.editar', 'crm.arquivar', 'crm.config', 'resultados.ver', 'agente.config'];

export const MODELOS_CRM: Record<IdModelo, ModeloCrm> = {
  clinica: {
    id: 'clinica', nome: 'Clínica', descricao: 'Pacientes, agendamento e assuntos de consultório.', termo: 'paciente',
    etapas: [
      { id: 'novo', ordem: 1, nome: 'Novo lead', tipo: 'aberta', gatilho: 'Primeira mensagem' },
      { id: 'contato', ordem: 2, nome: 'Contato realizado', tipo: 'aberta', gatilho: 'IA respondeu' },
      { id: 'interesse', ordem: 3, nome: 'Interesse identificado', tipo: 'aberta', gatilho: 'Pediu preço ou informou o motivo' },
      { id: 'oferecido', ordem: 4, nome: 'Agendamento oferecido', tipo: 'aberta', gatilho: 'Horários enviados' },
      { id: 'followup', ordem: 5, nome: 'Follow up', tipo: 'aberta', gatilho: 'Follow-up enviado' },
      { id: 'confirmado', ordem: 6, nome: 'Agendamento confirmado', tipo: 'ganho', gatilho: 'Agendamento criado no sistema' },
      { id: 'perdido', ordem: 7, nome: 'Perdido', tipo: 'perdido', gatilho: 'Follow-up sem resposta' },
    ],
    topicos: [
      { id: 'receita', ordem: 1, nome: 'Receita', icone: 'receita', palavras: 'receita, renovação de receita' },
      { id: 'docs', ordem: 2, nome: 'Notas fiscais e documentos', icone: 'doc', palavras: 'nota fiscal, laudo, atestado, relatório' },
      { id: 'exames', ordem: 3, nome: 'Exames', icone: 'exame', palavras: 'pedido de exame, resultado de exame' },
      { id: 'valores', ordem: 4, nome: 'Valores e pagamento', icone: 'valor', palavras: 'valor, desconto, Pix, comprovante' },
      { id: 'agenda', ordem: 5, nome: 'Agenda e encaixe', icone: 'agenda', palavras: 'agendar, remarcar, encaixe, cancelar' },
      { id: 'outros', ordem: 6, nome: 'Outros', icone: 'outros', palavras: 'o que não se encaixar nos outros' },
    ],
    config: { modelo: 'clinica', termo_contato: 'paciente', etapas_atendimento: ETAPAS_ATENDIMENTO, campos_cartao: CAMPOS_CARTAO },
    permissoes: [...BASE, 'pagamentos.ver', 'pagamentos.conferir'],
  },
  assistencia: {
    id: 'assistencia', nome: 'Assistência técnica', descricao: 'Clientes, ordem de serviço, orçamento e garantia.', termo: 'cliente',
    etapas: [
      { id: 'novo', ordem: 1, nome: 'Novo contato', tipo: 'aberta', gatilho: 'Primeira mensagem' },
      { id: 'diagnostico', ordem: 2, nome: 'Diagnóstico', tipo: 'aberta', gatilho: MANUAL },
      { id: 'oferecido', ordem: 3, nome: 'Orçamento enviado', tipo: 'aberta', gatilho: 'Orçamento enviado' },
      { id: 'followup', ordem: 4, nome: 'Follow up', tipo: 'aberta', gatilho: 'Follow-up enviado' },
      { id: 'confirmado', ordem: 5, nome: 'Aprovado', tipo: 'ganho', gatilho: 'Cliente aprovou' },
      { id: 'perdido', ordem: 6, nome: 'Recusado', tipo: 'perdido', gatilho: 'Follow-up sem resposta' },
    ],
    topicos: [
      { id: 'os', ordem: 1, nome: 'Ordem de serviço', icone: 'os', palavras: 'ordem de serviço, OS, conserto, andamento' },
      { id: 'garantia', ordem: 2, nome: 'Garantia', icone: 'garantia', palavras: 'garantia, defeito de novo, troca' },
      { id: 'pecas', ordem: 3, nome: 'Peças e orçamento', icone: 'caixa', palavras: 'peça, orçamento, preço' },
      { id: 'entrega', ordem: 4, nome: 'Entrega e retirada', icone: 'agenda', palavras: 'retirar, entregar, buscar, pronto' },
      { id: 'financeiro', ordem: 5, nome: 'Financeiro', icone: 'recibo', palavras: 'boleto, nota fiscal, pagamento, Pix' },
      { id: 'outros', ordem: 6, nome: 'Outros', icone: 'outros', palavras: 'o que não se encaixar nos outros' },
    ],
    config: { modelo: 'assistencia', termo_contato: 'cliente', etapas_atendimento: ETAPAS_ATENDIMENTO, campos_cartao: CAMPOS_CARTAO },
    permissoes: BASE,
  },
  contabilidade: {
    id: 'contabilidade', nome: 'Contabilidade', descricao: 'Clientes, documentos do mês, impostos e folha.', termo: 'cliente',
    etapas: [
      { id: 'novo', ordem: 1, nome: 'Novo lead', tipo: 'aberta', gatilho: 'Primeira mensagem' },
      { id: 'reuniao', ordem: 2, nome: 'Reunião agendada', tipo: 'aberta', gatilho: 'Reunião marcada' },
      { id: 'oferecido', ordem: 3, nome: 'Proposta enviada', tipo: 'aberta', gatilho: 'Proposta enviada' },
      { id: 'followup', ordem: 4, nome: 'Follow up', tipo: 'aberta', gatilho: 'Follow-up enviado' },
      { id: 'confirmado', ordem: 5, nome: 'Contrato fechado', tipo: 'ganho', gatilho: 'Contrato assinado' },
      { id: 'perdido', ordem: 6, nome: 'Perdido', tipo: 'perdido', gatilho: 'Follow-up sem resposta' },
    ],
    topicos: [
      { id: 'documentos', ordem: 1, nome: 'Documentos do mês', icone: 'doc', palavras: 'extrato, nota, documento do mês' },
      { id: 'impostos', ordem: 2, nome: 'Impostos e guias', icone: 'recibo', palavras: 'guia, DAS, imposto, DARF' },
      { id: 'folha', ordem: 3, nome: 'Folha de pagamento', icone: 'pessoa', palavras: 'folha, holerite, funcionário, férias' },
      { id: 'abertura', ordem: 4, nome: 'Abertura e alterações', icone: 'predio', palavras: 'abrir empresa, alteração contratual, CNPJ' },
      { id: 'financeiro', ordem: 5, nome: 'Financeiro', icone: 'valor', palavras: 'honorário, boleto, pagamento' },
      { id: 'outros', ordem: 6, nome: 'Outros', icone: 'outros', palavras: 'o que não se encaixar nos outros' },
    ],
    config: { modelo: 'contabilidade', termo_contato: 'cliente', etapas_atendimento: ETAPAS_ATENDIMENTO, campos_cartao: CAMPOS_CARTAO },
    permissoes: BASE,
  },
};

export const LISTA_MODELOS = Object.values(MODELOS_CRM).map(({ id, nome, descricao }) => ({ id, nome, descricao }));
export const ehModelo = (v: unknown): v is IdModelo => typeof v === 'string' && v in MODELOS_CRM;
