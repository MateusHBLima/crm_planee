// Endpoints:
//   GET  /whatsapp/webhook   verificação da Meta (hub.challenge)
//   POST /whatsapp/webhook   eventos da Meta: confere a assinatura, guarda, repassa para a Sara, responde 200
//   POST /whatsapp/envio     a Sara (n8n) registra o que mandou pela API (cabeçalho x-receptor-chave)
//   GET  /whatsapp/saude     fila, atraso e banco (para monitor externo)
//   GET  /whatsapp/vivo      o processo está de pé (healthcheck do Docker; não depende do banco)
import http from 'node:http';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { central } from './banco.js';
import { assinaturaValida } from './meta.js';
import { registrarEnvio, resumoDoEvento } from './processar.js';
import { timingSafeEqual } from 'node:crypto';
import { destinoDoRepasse } from './rotas.js';
import { marcarRepasse, repassar } from './repasse.js';
import { guardarNoSpool, tamanhoSpool } from './spool.js';
import { gravarEvento } from './trabalhador.js';
import { erroCurto, log } from './log.js';

const responder = (res, status, corpo, tipo = 'application/json') => {
  res.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store' });
  res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
};

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    const partes = []; let tam = 0;
    req.on('data', (p) => {
      tam += p.length;
      if (tam > config.maxCorpo) { falha(Object.assign(new Error('grande demais'), { status: 413 })); req.destroy(); return; }
      partes.push(p);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', falha);
  });
}

const comLimite = (p, ms) => Promise.race([p, new Promise((_, f) => setTimeout(() => f(new Error(`sem resposta em ${ms} ms`)), ms))]);

async function receberEvento(req, res) {
  let corpo;
  try { corpo = await lerCorpo(req); } catch (e) { return responder(res, e.status || 400, { erro: 'corpo inválido' }); }
  const assinatura = req.headers['x-hub-signature-256'];
  if (!config.appSecrets.length) return responder(res, 503, { erro: 'META_APP_SECRET não configurado' });
  if (!assinaturaValida(corpo, assinatura)) {
    log('aviso', 'assinatura inválida: evento recusado', { ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress });
    return responder(res, 401, { erro: 'assinatura inválida' });
  }
  let json;
  try { json = JSON.parse(corpo.toString('utf8')); } catch { return responder(res, 400, { erro: 'JSON inválido' }); }
  const texto = corpo.toString('utf8');
  const hash = createHash('sha256').update(corpo).digest('hex');
  const { numero, campo } = resumoDoEvento(json);
  const destino = config.repassarCampos.includes(campo) ? destinoDoRepasse(numero) : '';
  const reg = { hash, numero, campo, corpo: texto, assinatura, repassar: Boolean(destino) };

  // 1) Guarda. Se o banco central não responder em 2,5 s, guarda no arquivo local e segue.
  let id = null; let novo = true; let noSpool = false;
  try {
    id = await comLimite(gravarEvento(reg), 2500);
    novo = id !== null; // null = a Meta mandou o mesmo evento de novo: não repassa duas vezes
  } catch (e) {
    noSpool = true;
    log('erro', 'banco central fora: evento vai para o spool', { erro: erroCurto(e) });
  }

  // 2) Repassa para a Sara (n8n) sem esperar o resto. Com o banco fora, espera o repasse para anotar no spool.
  if (novo && destino) {
    const tarefa = repassar(destino, texto, assinatura)
      .then(() => { reg.repassado_em = new Date().toISOString(); if (id) return marcarRepasse(id, null); })
      .catch((e) => { log('erro', 'repasse para o n8n falhou; vou tentar de novo', { erro: erroCurto(e) }); if (id) return marcarRepasse(id, erroCurto(e)); });
    if (noSpool) await tarefa;
  }
  if (noSpool) {
    try { guardarNoSpool({ ...reg, recebido_em: new Date().toISOString() }); }
    catch (e) { log('erro', 'spool também falhou: a Meta vai reenviar', { erro: erroCurto(e) }); return responder(res, 500, { erro: 'indisponível' }); }
  }
  responder(res, 200, 'EVENT_RECEIVED', 'text/plain');
}

const chaveCerta = (veio) => {
  if (!config.chaveInterna || typeof veio !== 'string') return false;
  const a = Buffer.from(veio); const b = Buffer.from(config.chaveInterna);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function envio(req, res) {
  if (!chaveCerta(req.headers['x-receptor-chave'])) return responder(res, 401, { erro: 'chave inválida' });
  let d;
  try { d = JSON.parse((await lerCorpo(req)).toString('utf8')); } catch { return responder(res, 400, { erro: 'JSON inválido' }); }
  try { await registrarEnvio(d); responder(res, 200, { ok: true }); }
  catch (e) { responder(res, 400, { erro: erroCurto(e) }); }
}

async function saude(res) {
  try {
    const r = await comLimite(central().query(
      `select count(*) filter (where processado_em is null)::int as pendentes,
              count(*) filter (where processado_em is null and tentativas >= 10)::int as desistidos,
              count(*) filter (where repassar and repassado_em is null)::int as repasses_pendentes,
              coalesce(extract(epoch from now() - min(recebido_em) filter (where processado_em is null)), 0)::int as atraso_s
         from wa_eventos`), 3000);
    responder(res, 200, { ok: true, ...r.rows[0], spool: tamanhoSpool(), instancia: config.instancia });
  } catch (e) {
    responder(res, 503, { ok: false, banco: 'fora', spool: tamanhoSpool(), erro: erroCurto(e) });
  }
}

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://receptor');
    try {
      if (url.pathname === '/whatsapp/webhook' && req.method === 'GET') {
        const q = url.searchParams;
        if (q.get('hub.mode') === 'subscribe' && config.verifyToken && q.get('hub.verify_token') === config.verifyToken) {
          return responder(res, 200, q.get('hub.challenge') || '', 'text/plain');
        }
        return responder(res, 403, { erro: 'verificação recusada' });
      }
      if (url.pathname === '/whatsapp/webhook' && req.method === 'POST') return await receberEvento(req, res);
      if (url.pathname === '/whatsapp/envio' && req.method === 'POST') return await envio(req, res);
      if (url.pathname === '/whatsapp/saude') return await saude(res);
      if (url.pathname === '/whatsapp/vivo') return responder(res, 200, { ok: true });
      responder(res, 404, { erro: 'não encontrado' });
    } catch (e) {
      log('erro', 'erro inesperado', { erro: erroCurto(e) });
      if (!res.headersSent) responder(res, 500, { erro: 'erro interno' });
    }
  });
}
