// Repasse do evento bruto para o n8n da Sara, idêntico ao que a Meta mandaria (mesmo corpo e mesma assinatura).
import { central } from './banco.js';
import { erroCurto, log } from './log.js';

export async function repassar(url, corpo, assinatura) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(assinatura ? { 'x-hub-signature-256': assinatura } : {}), 'user-agent': 'planee-receptor' },
    body: corpo,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`destino respondeu ${r.status}`);
}

export async function marcarRepasse(id, erro) {
  if (!id) return;
  try {
    if (erro) await central().query('update wa_eventos set repasse_tentativas = repasse_tentativas + 1, repasse_erro = $2 where id = $1', [id, erro]);
    else await central().query('update wa_eventos set repassado_em = now(), repasse_erro = null where id = $1', [id]);
  } catch (e) {
    log('erro', 'não consegui marcar o repasse', { id, erro: erroCurto(e) });
  }
}
