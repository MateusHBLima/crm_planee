// Arquivos de mídia no Supabase Storage (pasta privada; o painel serve com endereço assinado).
import { config } from './config.js';

export async function guardarArquivo(caminho, bytes, mime) {
  const url = `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${caminho.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.supabaseChave}`, apikey: config.supabaseChave, 'content-type': mime, 'x-upsert': 'true' },
    body: bytes,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Storage respondeu ${r.status}.`);
}

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'application/pdf': 'pdf',
};
export const extensao = (mime, nome) => {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (EXT[m]) return EXT[m];
  const n = /\.([a-z0-9]{1,8})$/i.exec(String(nome || ''));
  return n ? n[1].toLowerCase() : 'bin';
};
