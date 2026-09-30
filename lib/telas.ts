import type { Modo } from './modo';
import type { Papel } from './sessao';

export type Tela = { id: string; nome: string; icone: string; descricao: string; papeis: Papel[] };

// Caminhos dos ícones: função icones() do protótipo (traço 1,8px, 24x24).
export const ICONES: Record<string, string> = {
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  crm: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  dash: 'M5 20V11M12 20V5M19 20v-7M3 20h18',
  config: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  interno: 'M3 12h4l3-7 4 14 3-7h4',
  clientes: 'M4 20V8l8-4 8 4v12M9 20v-6h6v6',
  // Estados e assuntos do CRM (função icones() do protótipo)
  aguardando: 'M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4',
  em_atendimento: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 20a8 8 0 0 1 16 0',
  pendente: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM10 9v6M14 9v6',
  finalizado: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12l3 3 5-6',
  receita: 'M9 3h6v4H9zM6 7h12v14H6zM12 11v6M9 14h6',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  exame: 'M9 3h6M10 3v6l-5 10h14l-5-10V3M7.5 15h9',
  valor: 'M3 6h18v12H3zM3 10h18M7 15h3',
  agenda: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
  outros: 'M5 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M17 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  pessoa: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 20a8 8 0 0 1 16 0',
  busca: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4',
  relogio: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
  nota: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  check: 'M5 12l5 5L20 7',
  fechar: 'M6 6l12 12M18 6L6 18',
  conversa: 'M4 5h16v11H9l-5 4z',
  arquivo: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  atualizar: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  sair: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  sol: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  lua: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
};

const CLIENTE: Tela[] = [
  { id: 'inbox', nome: 'Inbox', icone: 'inbox', descricao: 'Espelho do WhatsApp: conversas, lido e não lido, quem está atendendo. Fase 1.1.', papeis: ['secretaria', 'gestor', 'planee'] },
  { id: 'crm', nome: 'CRM', icone: 'crm', descricao: 'Quadro de atendimento por assunto e funil comercial. Fase 1.2.', papeis: ['secretaria', 'gestor', 'planee'] },
  { id: 'resultados', nome: 'Resultados', icone: 'dash', descricao: 'Consultas marcadas pela IA, conversas por dia, espera pela equipe. Fase 1.3.', papeis: ['gestor', 'planee'] },
  { id: 'configuracoes', nome: 'Configurações', icone: 'config', descricao: 'Configuração do CRM e do agente. Fases 3 e 4.', papeis: ['gestor', 'planee'] },
];

const ADM: Tela[] = [
  { id: 'clientes', nome: 'Clientes', icone: 'clientes', descricao: 'Lista de clientes e acesso a cada painel. Tarefa 0.2b.', papeis: ['planee'] },
  { id: 'interno', nome: 'Interno Planee', icone: 'interno', descricao: 'Custo, cache, falhas e alertas de todos os clientes. Fase 1.4.', papeis: ['planee'] },
];

export function telasDo(modo: Modo, papel?: Papel): Tela[] {
  const todas = modo === 'adm' ? ADM : CLIENTE;
  return papel ? todas.filter((t) => t.papeis.includes(papel)) : todas;
}
