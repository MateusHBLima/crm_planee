'use server';

import { comUsuario } from './resposta';
import * as inbox from './inbox';

// Ações da Inbox. Cada uma confere a sessão, a empresa e a permissão (inbox.ver; para enviar, inbox.responder) no servidor.

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

// Resposta pelo painel: vai ao webhook do n8n; a mensagem entra no espelho quando o receptor registra o envio.
// Devolve o wamid para a tela mostrar a bolha "enviando…" até a conversa trazer a mensagem.
export async function enviarMensagem(numeroId: string, waId: string, texto: string) {
  return comUsuario((u) => inbox.enviarMensagem(u, numeroId, waId, texto), 'inbox');
}

// Assumir a conversa (a Sara fica quieta) ou devolver para a Sara. Devolve a linha da lista atualizada.
export async function assumirConversa(numeroId: string, waId: string) {
  return comUsuario((u) => inbox.mudarDono(u, numeroId, waId, 'humano'), 'inbox');
}

export async function devolverConversa(numeroId: string, waId: string) {
  return comUsuario((u) => inbox.mudarDono(u, numeroId, waId, 'ia'), 'inbox');
}
