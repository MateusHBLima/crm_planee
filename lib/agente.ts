// Configuração do agente de IA de cada empresa (27/10), em crm_config "agente", gravada pela API
// (PUT /api/v1/config/agente ou definir_config). Nenhum nome nem tempo de cliente fica no código (regra 9).
//   nome        nome do agente na Inbox ("Sara", "Amanda"). Sem a chave, "IA".
//   pausa_min   minutos que a IA fica quieta depois de uma resposta da equipe, pelo celular ou pelo painel (1 a 1440).
//               Sem a chave, SARA_PAUSA_CELULAR_MIN (7). O receptor usa a mesma regra.
//   assumir     true quando a IA consulta o dono da conversa (GET /whatsapp/atendimento): só então a Inbox mostra
//               "Assumir" (antes disso o botão prometia uma coisa que a IA não fazia).
//   avisos_url  webhook da IA da empresa que recebe "conversa devolvida" e "atendimento finalizado" (cada empresa o
//               seu; sem ele, nada é avisado). O segredo continua no N8N_WEBHOOK_SEGREDO da stack.

export const AGENTE_PADRAO = 'IA';

export type ConfigAgente = { nome: string; pausaMin: number; assumir: boolean; avisosUrl: string | null };

const PAUSA_PADRAO_MIN = () => Number(process.env.SARA_PAUSA_CELULAR_MIN) || 7;
// https sempre; http só na própria máquina (testes e desenvolvimento).
const URL_AVISO = /^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*)$/;

export function nomeDoValorAgente(valor: unknown): string {
  const nome = valor && typeof valor === 'object' ? (valor as { nome?: unknown }).nome : valor;
  return typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, 40) : AGENTE_PADRAO;
}

export function agenteDoValor(valor: unknown): ConfigAgente {
  const o = valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : {};
  const p = typeof o.pausa_min === 'number' || typeof o.pausa_min === 'string' ? Number(o.pausa_min) : NaN;
  const url = typeof o.avisos_url === 'string' && URL_AVISO.test(o.avisos_url.trim()) ? o.avisos_url.trim() : null;
  return {
    nome: nomeDoValorAgente(valor),
    pausaMin: Number.isFinite(p) && p >= 1 && p <= 1440 ? p : PAUSA_PADRAO_MIN(),
    assumir: o.assumir === true,
    avisosUrl: url,
  };
}
