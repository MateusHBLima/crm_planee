// POST /whatsapp/enviar (26/10): resposta da equipe pela Inbox do painel. O receptor é quem fala com a Meta:
//   1) envia o texto pela Graph API com o token do número (o mesmo cadastrado no painel para conectar);
//   2) repassa para a IA da empresa um eco igual ao de quando a equipe responde pelo celular (smb_message_echoes):
//      o n8n grava a fala como [EQUIPE] no histórico e a IA não responde junto. Vai logo depois do 200 da Meta, sem
//      esperar o banco (27/10: quanto antes a IA souber, menor a chance de ela responder junto);
//   3) grava no espelho com origem "painel" e quem mandou (a Inbox mostra "Painel · <nome>").
// POST /whatsapp/enviar-midia (27/10): o mesmo para foto, vídeo, áudio e documento. Áudio gravado na tela vira
// mensagem de voz (ogg/opus, como a do celular); vídeo fora de MP4 é convertido. O arquivo vai para o Storage
// na hora, para a Inbox mostrar sem baixar de novo da Meta.
// Para onde vai o eco: eco_url do número (empresa cuja IA recebe direto da Meta, como a SSA) ou, sem ele, o
// encaminhar_url (empresa cuja IA recebe pelo receptor, como a clínica).
// Assim nenhuma empresa precisa de workflow de envio no n8n nem de token da Meta lá dentro.
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, midiaConfigurada } from './config.js';
import { graph, graphApi } from './meta.js';
import { NumeroSemDono, registrarEnvio } from './processar.js';
import { destinoDoEco, rota, segredoDoNumero, tokenDoNumero } from './rotas.js';
import { repassar } from './repasse.js';
import { extensao, guardarArquivo } from './armazenamento.js';
import { erroCurto, log } from './log.js';

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const ID_NUMERO = /^[A-Za-z0-9_.:-]{1,64}$/;
const PARA = /^\d{8,20}$/;
// Texto que é só um comando ("/r", "/p", "/a"...): o buffer do n8n trata o eco como a equipe digitando o comando,
// e "/r" apaga o histórico da conversa. Pelo painel não vai.
export const SO_COMANDO = /^\/\S+$/;

// Eco no formato da Meta, assinado com o segredo do app do número (o n8n confere como confere o da Meta).
// msg: o que vai em message_echoes[0] além de from/to/id/timestamp ({type:'text', text:{body}} ou a mídia).
export function montarEco({ numero, waba, telefone, para, wamid, ts, por, msg }) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: waba || numero,
      changes: [{
        field: 'smb_message_echoes',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: telefone || '', phone_number_id: numero },
          message_echoes: [{ from: telefone || '', to: para, id: wamid, timestamp: String(ts), ...msg }],
        },
      }],
    }],
    // Fora do formato da Meta, para quem quiser separar: a resposta saiu pelo painel, não pelo celular.
    // O receptor também usa: quando o n8n devolve uma cópia deste eco, a mensagem continua "Painel · nome".
    painel: { origem: 'painel', por: por || null },
  });
}

async function ecoParaIa(r, d) {
  if (!config.ecoDoPainel || !config.repassarCampos.includes('smb_message_echoes')) return;
  const url = destinoDoEco(d.numero);
  if (!url) return;
  const corpo = montarEco({ ...d, waba: r.waba_id, telefone: r.telefone });
  const segredo = segredoDoNumero(d.numero);
  const assinatura = segredo ? 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex') : null;
  try { await repassar(url, corpo, assinatura); }
  catch (e) { log('erro', 'eco do envio pelo painel não chegou na IA', { numero: d.numero, erro: erroCurto(e) }); }
}

async function validarPedido(numero, para) {
  if (!ID_NUMERO.test(numero) || !PARA.test(para)) throw new Error('Informe phone_number_id e to.');
  const r = await rota(numero);
  if (!r) throw new NumeroSemDono(`Número ${numero} não cadastrado em whatsapp_numeros.`);
  return r;
}

// Envia uma mensagem já montada (corpo da Graph API sem to/messaging_product). {ok:false, erro} quando a Meta recusa.
async function mandar(numero, para, token, corpo) {
  try {
    const resposta = await graphApi(`${encodeURIComponent(numero)}/messages`, token, {
      metodo: 'POST', corpo: { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...corpo },
    });
    const wamid = resposta?.messages?.[0]?.id;
    return wamid ? { ok: true, wamid } : { ok: false, erro: 'sem_wamid' };
  } catch (e) {
    log('erro', 'Meta recusou o envio pelo painel', { numero, erro: erroCurto(e) });
    return { ok: false, erro: e.codigoMeta || 'meta' };
  }
}

export async function enviarPeloPainel(d) {
  const numero = String(d.phone_number_id || '');
  const para = digitos(d.to);
  const texto = typeof d.texto === 'string' ? d.texto.trim() : '';
  const por = typeof d.por === 'string' && d.por.trim() ? d.por.trim().slice(0, 80) : null;
  if (!ID_NUMERO.test(numero) || !PARA.test(para)) throw new Error('Informe phone_number_id e to.');
  if (!texto || texto.length > 4096) throw new Error('Texto vazio ou maior que 4.096 caracteres.');
  if (SO_COMANDO.test(texto)) throw new Error('Comandos não podem ser enviados pelo painel.');
  const r = await validarPedido(numero, para);
  const token = tokenDoNumero(numero);
  if (!token) return { ok: false, erro: 'sem_token' };

  const envio = await mandar(numero, para, token, { type: 'text', text: { preview_url: false, body: texto } });
  if (!envio.ok) return envio;
  const { wamid } = envio;
  const ts = Math.floor(Date.now() / 1000);
  void ecoParaIa(r, { numero, para, wamid, ts, por, msg: { type: 'text', text: { body: texto } } }); // não espera
  // A mensagem já saiu: falha daqui para baixo não pode virar "não enviada" (a equipe mandaria de novo).
  try { await registrarEnvio({ phone_number_id: numero, to: para, wamid, tipo: 'text', texto, timestamp: ts, origem: 'painel', por }); }
  catch (e) { log('erro', 'enviada, mas não gravei no espelho', { numero, erro: erroCurto(e) }); }
  log('info', 'enviada pelo painel', { numero });
  return { ok: true, wamid };
}

// ---- Mídia ----

const MB = 1024 * 1024;
// Limites da Meta (Cloud API): foto 5 MB; áudio e vídeo 16 MB; documento 100 MB (aqui até o corpo do receptor).
const LIMITE = { image: 5 * MB, audio: 16 * MB, video: 16 * MB, document: 100 * MB };
const AUDIO_ACEITO = ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'];
const VIDEO_ACEITO = ['video/mp4', 'video/3gpp'];
const FOTO_ACEITA = ['image/jpeg', 'image/png'];
export const ERROS_MIDIA = {
  grande: 'grande_demais', vazio: 'arquivo_vazio', conversao: 'conversao_falhou', upload: 'upload_falhou',
};

// ffmpeg com arquivos temporários (MP4/MOV precisam de leitura com saltos, que a entrada por pipe não tem).
async function ffmpeg(bytes, extEntrada, extSaida, args, limiteMs = 60000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'painel-midia-'));
  const entrada = path.join(dir, `entrada.${extEntrada}`);
  const saida = path.join(dir, `saida.${extSaida}`);
  try {
    await fs.writeFile(entrada, bytes);
    await new Promise((ok, falha) => {
      const p = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', entrada, ...args, saida], { stdio: ['ignore', 'ignore', 'pipe'] });
      let erro = '';
      p.stderr.on('data', (x) => { erro = (erro + x).slice(-400); });
      const t = setTimeout(() => { p.kill('SIGKILL'); falha(new Error('ffmpeg passou do tempo')); }, limiteMs);
      p.on('error', (e) => { clearTimeout(t); falha(e); });
      p.on('close', (c) => { clearTimeout(t); c === 0 ? ok() : falha(new Error(`ffmpeg saiu com ${c}: ${erro.trim()}`)); });
    });
    return await fs.readFile(saida);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const mimeBase = (m) => String(m || '').split(';')[0].trim().toLowerCase();

// Decide como a Meta recebe o arquivo e converte quando precisa. Devolve {tipo, bytes, mime, voz}.
//   voz: áudio gravado na tela → ogg/opus mono (mensagem de voz, com o botão de tocar no celular do contato).
//   áudio em formato que a Meta não aceita (webm, wav...) → ogg/opus, como arquivo de áudio.
//   foto JPG/PNG → foto; outra imagem (webp, gif, heic) → documento, para chegar como veio.
//   vídeo MP4/3GP → vídeo; outro (mov, webm) → MP4 (H.264 + AAC, até 1280 px).
//   o resto → documento, com o nome do arquivo.
export async function prepararMidia({ bytes, mime, nome, voz }) {
  const m = mimeBase(mime);
  if (!bytes?.length) throw Object.assign(new Error('Arquivo vazio.'), { codigo: ERROS_MIDIA.vazio });
  const extEntrada = extensao(m, nome) === 'bin' ? 'dat' : extensao(m, nome);
  // 28/10: 48 kbps (antes 24 kbps, som abafado no celular do contato), mono, 48 kHz, modo "audio" do Opus.
  const opus = ['-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-application', 'audio', '-f', 'ogg'];
  if (m.startsWith('audio/') || voz) {
    if (voz) return { tipo: 'audio', bytes: await converter(bytes, extEntrada, 'ogg', opus), mime: 'audio/ogg', voz: true };
    if (AUDIO_ACEITO.includes(m)) return { tipo: 'audio', bytes, mime: m, voz: false };
    return { tipo: 'audio', bytes: await converter(bytes, extEntrada, 'ogg', opus), mime: 'audio/ogg', voz: false };
  }
  if (FOTO_ACEITA.includes(m) && bytes.length <= LIMITE.image) return { tipo: 'image', bytes, mime: m, voz: false };
  if (m.startsWith('video/')) {
    if (VIDEO_ACEITO.includes(m)) return { tipo: 'video', bytes, mime: m, voz: false };
    const mp4 = await converter(bytes, extEntrada, 'mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1280,iw)':-2", '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4'], 120000);
    return { tipo: 'video', bytes: mp4, mime: 'video/mp4', voz: false };
  }
  return { tipo: 'document', bytes, mime: m || 'application/octet-stream', voz: false };
}

async function converter(bytes, ext, extSaida, args, limiteMs) {
  try { return await ffmpeg(bytes, ext, extSaida, args, limiteMs); }
  catch (e) {
    log('erro', 'não consegui converter a mídia', { erro: erroCurto(e) });
    throw Object.assign(new Error('Não consegui converter o arquivo.'), { codigo: ERROS_MIDIA.conversao });
  }
}

// Sobe o arquivo na Meta (POST /<número>/media, multipart) e devolve o id da mídia.
async function subirNaMeta(numero, token, bytes, mime, nome) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([bytes], { type: mime }), nome);
  const r = await fetch(graph(`${encodeURIComponent(numero)}/media`), {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) {
    const e = new Error(`Meta ${r.status} ao subir a mídia${j.error?.code ? ` (código ${j.error.code})` : ''}: ${String(j.error?.message || 'sem detalhe').slice(0, 160)}`);
    e.codigoMeta = j.error?.code != null ? String(j.error.code) : null;
    throw e;
  }
  return String(j.id);
}

const nomeSeguro = (nome, ext) => {
  const n = String(nome || '').replace(/[\\/\r\n\t"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return n || `arquivo.${ext}`;
};

// d: {phone_number_id, to, nome, mime, legenda, por, voz, bytes}
export async function enviarMidiaPeloPainel(d) {
  const numero = String(d.phone_number_id || '');
  const para = digitos(d.to);
  const legenda = typeof d.legenda === 'string' ? d.legenda.trim().slice(0, 1024) : '';
  const por = typeof d.por === 'string' && d.por.trim() ? d.por.trim().slice(0, 80) : null;
  if (SO_COMANDO.test(legenda)) throw new Error('Comandos não podem ser enviados pelo painel.');
  const r = await validarPedido(numero, para);
  const token = tokenDoNumero(numero);
  if (!token) return { ok: false, erro: 'sem_token' };

  let p;
  try { p = await prepararMidia({ bytes: d.bytes, mime: d.mime, nome: d.nome, voz: Boolean(d.voz) }); }
  catch (e) { if (e.codigo) return { ok: false, erro: e.codigo }; throw e; }
  if (p.bytes.length > LIMITE[p.tipo]) return { ok: false, erro: ERROS_MIDIA.grande, tipo: p.tipo };
  const ext = extensao(p.mime, d.nome);
  const nome = p.tipo === 'document' ? nomeSeguro(d.nome, ext) : `${p.tipo}.${ext}`;

  let idMeta;
  try { idMeta = await subirNaMeta(numero, token, p.bytes, p.mime, nome); }
  catch (e) { log('erro', 'Meta recusou a mídia do painel', { numero, erro: erroCurto(e) }); return { ok: false, erro: e.codigoMeta || ERROS_MIDIA.upload }; }

  // Legenda: foto, vídeo e documento têm; áudio não (a tela manda o texto numa mensagem à parte).
  const conteudo = { id: idMeta };
  if (legenda && p.tipo !== 'audio') conteudo.caption = legenda;
  if (p.tipo === 'document') conteudo.filename = nome;
  if (p.voz) conteudo.voice = true;
  const envio = await mandar(numero, para, token, { type: p.tipo, [p.tipo]: conteudo });
  if (!envio.ok) return envio;
  const { wamid } = envio;
  const ts = Math.floor(Date.now() / 1000);
  void ecoParaIa(r, { numero, para, wamid, ts, por, msg: { type: p.tipo, [p.tipo]: { ...conteudo, mime_type: p.mime } } });

  // O arquivo vai para o Storage agora (a Inbox mostra sem esperar baixar da Meta). Se falhar, o laço de mídias
  // baixa pela Meta depois, como faz com as que chegam.
  let caminho = null;
  if (midiaConfigurada()) {
    const c = `${r.empresa_id}/${numero}/${wamid.replace(/[^\w.-]/g, '_')}.${ext}`;
    try { await guardarArquivo(c, p.bytes, p.mime); caminho = c; }
    catch (e) { log('erro', 'enviada, mas não guardei o arquivo no Storage', { numero, erro: erroCurto(e) }); }
  }
  try {
    await registrarEnvio({ phone_number_id: numero, to: para, wamid, tipo: p.tipo, texto: conteudo.caption || null, timestamp: ts, origem: 'painel', por,
      midia_id: idMeta, mime_type: p.mime, filename: p.tipo === 'document' ? nome : undefined, voz: p.voz || undefined,
      caminho, tamanho: caminho ? p.bytes.length : undefined });
  } catch (e) { log('erro', 'enviada, mas não gravei no espelho', { numero, erro: erroCurto(e) }); }
  log('info', 'mídia enviada pelo painel', { numero, tipo: p.tipo });
  return { ok: true, wamid, tipo: p.tipo };
}
