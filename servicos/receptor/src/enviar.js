// POST /whatsapp/enviar (26/10): resposta da equipe pela Inbox do painel. O receptor é quem fala com a Meta:
//   1) envia o texto pela Graph API com o token do número (o mesmo cadastrado no painel para conectar);
//   2) grava no espelho com origem "painel" e quem mandou (a Inbox mostra "Painel · <nome>");
//   3) repassa para a IA da empresa (encaminhar_url do número) um eco igual ao de quando a equipe responde pelo
//      celular (smb_message_echoes): o n8n grava a fala como [EQUIPE] no histórico e a IA não responde junto.
// Assim nenhuma empresa precisa de workflow de envio no n8n nem de token da Meta lá dentro.
import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { graphApi } from './meta.js';
import { NumeroSemDono, registrarEnvio } from './processar.js';
import { destinoDoRepasse, rota, segredoDoNumero, tokenDoNumero } from './rotas.js';
import { repassar } from './repasse.js';
import { erroCurto, log } from './log.js';

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

// Eco no formato da Meta, assinado com o segredo do app do número (o n8n confere como confere o da Meta).
export function montarEco({ numero, waba, telefone, para, wamid, texto, ts, por }) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: waba || numero,
      changes: [{
        field: 'smb_message_echoes',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: telefone || '', phone_number_id: numero },
          message_echoes: [{ from: telefone || '', to: para, id: wamid, timestamp: String(ts), type: 'text', text: { body: texto } }],
        },
      }],
    }],
    // Fora do formato da Meta, para quem quiser separar: a resposta saiu pelo painel, não pelo celular.
    painel: { origem: 'painel', por: por || null },
  });
}

async function ecoParaIa(r, d) {
  if (!config.ecoDoPainel || !config.repassarCampos.includes('smb_message_echoes')) return;
  const url = destinoDoRepasse(d.numero);
  if (!url) return;
  const corpo = montarEco({ ...d, waba: r.waba_id, telefone: r.telefone });
  const segredo = segredoDoNumero(d.numero);
  const assinatura = segredo ? 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex') : null;
  try { await repassar(url, corpo, assinatura); }
  catch (e) { log('erro', 'eco do envio pelo painel não chegou na IA', { numero: d.numero, erro: erroCurto(e) }); }
}

export async function enviarPeloPainel(d) {
  const numero = String(d.phone_number_id || '');
  const para = digitos(d.to);
  const texto = typeof d.texto === 'string' ? d.texto.trim() : '';
  const por = typeof d.por === 'string' && d.por.trim() ? d.por.trim().slice(0, 80) : null;
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(numero) || !/^\d{8,20}$/.test(para)) throw new Error('Informe phone_number_id e to.');
  if (!texto || texto.length > 4096) throw new Error('Texto vazio ou maior que 4.096 caracteres.');
  const r = await rota(numero);
  if (!r) throw new NumeroSemDono(`Número ${numero} não cadastrado em whatsapp_numeros.`);
  const token = tokenDoNumero(numero);
  if (!token) return { ok: false, erro: 'sem_token' };

  let resposta;
  try {
    resposta = await graphApi(`${encodeURIComponent(numero)}/messages`, token, {
      metodo: 'POST',
      corpo: { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: false, body: texto } },
    });
  } catch (e) {
    log('erro', 'Meta recusou o envio pelo painel', { numero, erro: erroCurto(e) });
    return { ok: false, erro: e.codigoMeta || 'meta' };
  }
  const wamid = resposta?.messages?.[0]?.id;
  if (!wamid) return { ok: false, erro: 'sem_wamid' };
  const ts = Math.floor(Date.now() / 1000);

  // A mensagem já saiu: falha daqui para baixo não pode virar "não enviada" (a equipe mandaria de novo).
  try { await registrarEnvio({ phone_number_id: numero, to: para, wamid, tipo: 'text', texto, timestamp: ts, origem: 'painel', por }); }
  catch (e) { log('erro', 'enviada, mas não gravei no espelho', { numero, erro: erroCurto(e) }); }
  void ecoParaIa(r, { numero, para, wamid, texto, ts, por }); // não segura a resposta ao painel
  log('info', 'enviada pelo painel', { numero });
  return { ok: true, wamid };
}
