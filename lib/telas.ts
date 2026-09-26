import type { Modo } from './modo';

export type Tela = { id: string; nome: string; icone: string; descricao: string };

// Caminhos dos ícones: função icones() do protótipo (traço 1,8px, 24x24).
export const ICONES: Record<string, string> = {
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  crm: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  dash: 'M5 20V11M12 20V5M19 20v-7M3 20h18',
  config: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  interno: 'M3 12h4l3-7 4 14 3-7h4',
  clientes: 'M4 20V8l8-4 8 4v12M9 20v-6h6v6',
  sol: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  lua: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
};

const CLIENTE: Tela[] = [
  { id: 'inbox', nome: 'Inbox', icone: 'inbox', descricao: 'Espelho do WhatsApp: conversas, lido e não lido, quem está atendendo. Fase 1.1.' },
  { id: 'crm', nome: 'CRM', icone: 'crm', descricao: 'Quadro de atendimento por assunto e funil comercial. Fase 1.2.' },
  { id: 'resultados', nome: 'Resultados', icone: 'dash', descricao: 'Consultas marcadas pela IA, conversas por dia, espera pela equipe. Fase 1.3.' },
  { id: 'configuracoes', nome: 'Configurações', icone: 'config', descricao: 'Configuração do CRM e do agente. Fases 3 e 4.' },
];

const ADM: Tela[] = [
  { id: 'clientes', nome: 'Clientes', icone: 'clientes', descricao: 'Lista de clientes e acesso a cada painel. Tarefa 0.2b.' },
  { id: 'interno', nome: 'Interno Planee', icone: 'interno', descricao: 'Custo, cache, falhas e alertas de todos os clientes. Fase 1.4.' },
];

export function telasDo(modo: Modo): Tela[] {
  return modo === 'adm' ? ADM : CLIENTE;
}
