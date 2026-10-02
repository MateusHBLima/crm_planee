// Meta (WhatsApp Cloud API): assinatura do webhook e download de mídia.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256(App Secret, corpo bruto). Sem isso, qualquer um poderia
// inventar mensagens no painel.
export function assinaturaValida(corpo, cabecalho) {
  if (!config.appSecret || typeof cabecalho !== 'string' || !cabecalho.startsWith('sha256=')) return false;
  const esperado = Buffer.from(createHmac('sha256', config.appSecret).update(corpo).digest('hex'));
  const veio = Buffer.from(cabecalho.slice(7));
  return veio.length === esperado.length && timingSafeEqual(veio, esperado);
}

const graph = (caminho) => `${config.graphUrl}/${config.graphVersao}/${caminho}`;

// Baixa a mídia pelo id: primeiro o endereço temporário (vale poucos minutos), depois os bytes.
export async function baixarMidia(id) {
  const auth = { authorization: `Bearer ${config.metaToken}` };
  const info = await fetch(graph(encodeURIComponent(id)), { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!info.ok) throw new Error(`Meta respondeu ${info.status} ao pedir a mídia.`);
  const j = await info.json();
  if (!j.url) throw new Error('Meta não devolveu o endereço da mídia.');
  const r = await fetch(j.url, { headers: auth, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Download da mídia falhou (${r.status}).`);
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: j.mime_type || r.headers.get('content-type') || 'application/octet-stream' };
}
