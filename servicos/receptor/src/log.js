// Log em uma linha JSON, sem dado pessoal (nunca o corpo do evento, telefone ou texto de mensagem).
export function log(nivel, msg, extra = {}) {
  const linha = JSON.stringify({ em: new Date().toISOString(), nivel, msg, ...extra });
  (nivel === 'erro' ? console.error : console.log)(linha);
}
export const erroCurto = (e) => String((e && (e.code ? `${e.code} ` : '') + (e.message || e)) || e).replace(/\d{8,}/g, '[n]').slice(0, 300);
