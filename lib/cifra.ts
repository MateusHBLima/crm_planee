import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Cifra do endereço do banco de cada empresa (decisão 26). A chave existe só na variável PAINEL_CHAVE_CIFRA
// do servidor; no banco central fica apenas o texto cifrado (AES-256-GCM).

function chave(): Buffer {
  const k = process.env.PAINEL_CHAVE_CIFRA;
  if (!k || k.length < 32) throw new Error('Falta PAINEL_CHAVE_CIFRA (mínimo 32 caracteres) neste deploy.');
  return createHash('sha256').update(k).digest();
}

export const cifraConfigurada = () => Boolean(process.env.PAINEL_CHAVE_CIFRA && process.env.PAINEL_CHAVE_CIFRA.length >= 32);

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

export function decifrar(cifrado: string): string {
  const [v, iv, tag, dados] = cifrado.split(':');
  if (v !== 'v1' || !iv || !tag || !dados) throw new Error('Texto cifrado em formato desconhecido.');
  const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}
