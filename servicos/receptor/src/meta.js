// Meta (WhatsApp Cloud API): assinatura do webhook e download de mídia.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { segredosDosNumeros } from './rotas.js';

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256(App Secret, corpo bruto). Sem isso, qualquer um poderia
// inventar mensagens no painel. Cada app da Meta assina com o próprio segredo; vale qualquer um da lista.
export function assinaturaValida(corpo, cabecalho) {
  const segredos = [...config.appSecrets, ...segredosDosNumeros()];
  if (!segredos.length || typeof cabecalho !== 'string' || !cabecalho.startsWith('sha256=')) return false;
  const veio = Buffer.from(cabecalho.slice(7));
  return segredos.some((segredo) => {
    const esperado = Buffer.from(createHmac('sha256', segredo).update(corpo).digest('hex'));
    return veio.length === esperado.length && timingSafeEqual(veio, esperado);
  });
}

const graph = (caminho) => `${config.graphUrl}/${config.graphVersao}/${caminho}`;

// Baixa a mídia pelo id: primeiro o endereço temporário (vale poucos minutos), depois os bytes.
export async function baixarMidia(id, token) {
  if (!token) throw new Error('Número sem token da Meta (cadastre no painel).');
  const auth = { authorization: `Bearer ${token}` };
  const info = await fetch(graph(encodeURIComponent(id)), { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!info.ok) throw new Error(`Meta respondeu ${info.status} ao pedir a mídia.`);
  const j = await info.json();
  if (!j.url) throw new Error('Meta não devolveu o endereço da mídia.');
  const r = await fetch(j.url, { headers: auth, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Download da mídia falhou (${r.status}).`);
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: j.mime_type || r.headers.get('content-type') || 'application/octet-stream' };
}

// Chamada à Graph API com o token do número. Erro da Meta volta com o código e a mensagem curta.
export async function graphApi(caminho, token, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(graph(caminho), {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    throw new Error(`Meta ${r.status}${e.code ? ` (código ${e.code})` : ''}: ${String(e.message || 'sem detalhe').slice(0, 160)}`);
  }
  return j;
}
