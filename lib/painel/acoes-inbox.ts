'use server';

import { comUsuario } from './resposta';
import * as inbox from './inbox';

// Ações da Inbox (somente leitura). Cada uma confere a sessão, a empresa e a permissão inbox.ver no servidor.

export async function carregarConversas(busca?: string) {
  return comUsuario((u) => inbox.listarConversas(u, busca), 'inbox');
}

// Abre (ou atualiza, ou pagina para trás) uma conversa. A equipe da empresa marca como lida ao abrir;
// o master só olha. Devolve as mensagens e a linha da lista já com as não lidas atualizadas.
export async function abrirConversa(numeroId: string, waId: string, antesDeId?: string | null) {
  return comUsuario(async (u) => {
    if (!antesDeId) await inbox.marcarLida(u, numeroId, waId);
    return inbox.lerConversa(u, numeroId, waId, antesDeId);
  }, 'inbox');
}
