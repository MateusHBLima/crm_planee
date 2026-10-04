// Testes do receptor contra um Postgres LOCAL e descartável, com Meta, n8n e Storage falsos.
// Uso: RECEPTOR_DB=postgres://postgres@localhost:5432/receptor_teste npm test (senha, se houver, em PGPASSWORD)
// O banco é apagado e recriado. Dados 100% fictícios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createHmac, createCipheriv, createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const DB = process.env.RECEPTOR_DB || 'postgres://postgres@localhost:5432/receptor_teste';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) throw new Error('RECEPTOR_DB precisa ser local.');
const RAIZ = path.resolve(import.meta.dirname, '../../..');
const SEGREDO = 'segredo-de-teste-do-app';
const SEGREDO_OUTRO_APP = 'segredo-do-app-da-clinica';
const NUM = '100000000000001';      // phone_number_id fictício
const MEU = '5547900000000';        // número de exibição fictício da clínica
const PAC = '5547911110001';        // paciente fictício
const PORTA = 3910;
const B = `http://127.0.0.1:${PORTA}`;
const sql = new pg.Pool({ connectionString: DB, max: 2 });
const CHAVE_CIFRA = 'chave-de-teste-local-com-mais-de-32-caracteres';
// Mesmo formato de lib/cifra.ts do painel.
function cifrar(texto) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(CHAVE_CIFRA).digest(), iv);
  const d = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), d.toString('base64')].join(':');
}
const graphPedidos = [];
const q = async (t, p) => (await sql.query(t, p)).rows;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(fn, ms = 8000) {
  const fim = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > fim) return v; await esperar(150); }
}

// ---- Falsos: n8n, Graph API e Storage ----
const n8n = { recebidos: [], falhar: false };
const storage = { arquivos: {} };
const servidores = [];
function servidor(porta, fn) {
  const s = http.createServer((req, res) => { const p = []; req.on('data', (x) => p.push(x)); req.on('end', () => fn(req, res, Buffer.concat(p))); });
  s.listen(porta); servidores.push(s); return s;
}

let receptor;
function subirReceptor(extra = {}) {
  const p = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      PATH: process.env.PATH, PORTA: String(extra.PORTA || PORTA), CENTRAL_DATABASE_URL: extra.CENTRAL_DATABASE_URL || DB, DATABASE_URL: DB,
      EMPRESA_BANCO_PADRAO: 'teste', META_APP_SECRET: `${SEGREDO}, ${SEGREDO_OUTRO_APP}`, META_VERIFY_TOKEN: 'token-verificacao', RECEPTOR_CHAVE_INTERNA: 'chave-interna-teste',
      META_TOKEN: 'token-meta-falso', META_GRAPH_URL: 'http://127.0.0.1:3912', SUPABASE_URL: 'http://127.0.0.1:3913', SUPABASE_SERVICE_KEY: 'chave-storage-falsa',
      ENCAMINHAR_PADRAO: 'http://127.0.0.1:3911/padrao', SPOOL_DIR: extra.SPOOL_DIR || path.join(os.tmpdir(), 'receptor-spool-teste'),
      HOSTNAME: extra.HOSTNAME || 'teste', WA_INTERVALO_MS: '200', WA_ROTAS_MS: '500', PAINEL_CHAVE_CIFRA: CHAVE_CIFRA,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.saida = '';
  p.stdout.on('data', (d) => { p.saida += d; }); p.stderr.on('data', (d) => { p.saida += d; });
  return p;
}
async function pronto(porta = PORTA) {
  return ate(async () => { try { return (await fetch(`http://127.0.0.1:${porta}/whatsapp/vivo`)).ok; } catch { return false; } }, 10000);
}

const assinar = (corpo, segredo = SEGREDO) => 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex');
async function enviar(evento, { segredo, porta = PORTA } = {}) {
  const corpo = JSON.stringify(evento);
  return fetch(`http://127.0.0.1:${porta}/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinar(corpo, segredo) }, body: corpo });
}
const ts = (s = 0) => String(Math.floor(Date.now() / 1000) + s);
const ev = (field, value, numero = NUM) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA_FICTICIA', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: MEU, phone_number_id: numero }, ...value } }] }],
});
const msgEntrada = (id, extra) => ev('messages', { contacts: [{ profile: { name: 'Paciente Ficticio' }, wa_id: PAC }], messages: [{ from: PAC, id, timestamp: ts(), ...extra }] });
const eco = (id, extra) => ev('smb_message_echoes', { message_echoes: [{ from: MEU, to: PAC, id, timestamp: ts(), ...extra }] });
const msgs = (where = '') => q(`select * from wa_mensagens ${where} order by id`);

before(async () => {
  const admin = new pg.Pool({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  await admin.query('drop database if exists receptor_teste').catch(() => undefined);
  await admin.query('create database receptor_teste');
  await admin.end();
  for (const f of ['001_crm_api.sql', '003_painel_login.sql', '004_central_empresas.sql', '007_whatsapp_central.sql', '008_whatsapp_dados.sql', '009_whatsapp_dono.sql', '011_whatsapp_cadastro.sql']) {
    execSync(`psql -q -v ON_ERROR_STOP=1 "${DB}" -f "${path.join(RAIZ, 'supabase/migrations', f)}"`, { stdio: 'pipe' });
  }
  await q(`insert into whatsapp_numeros (phone_number_id, empresa_id, nome, telefone, encaminhar_url) values ($1, 'teste', 'Número de teste', $2, 'http://127.0.0.1:3911/sara')`, [NUM, MEU]);
  fs.rmSync(path.join(os.tmpdir(), 'receptor-spool-teste'), { recursive: true, force: true });

  servidor(3911, (req, res, corpo) => {
    if (n8n.falhar) { res.writeHead(502); return res.end(); }
    n8n.recebidos.push({ url: req.url, corpo: corpo.toString(), assinatura: req.headers['x-hub-signature-256'] });
    res.writeHead(200); res.end('ok');
  });
  servidor(3912, (req, res, corpo) => { // Graph API
    graphPedidos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization, corpo: corpo.toString() });
    const json = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!['Bearer token-meta-falso', 'Bearer token-do-numero-novo'].includes(req.headers.authorization)) return json(401, { error: { code: 190, message: 'Invalid OAuth access token' } });
    if (req.method === 'POST') return json(200, { success: true });
    if (req.url.includes('fields=')) return json(200, { display_phone_number: '+55 47 90000-0002', verified_name: 'Empresa Ficticia Dois', id: '100000000000002' });
    if (req.url.startsWith('/arquivo/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from('JPEGFALSO')); }
    const id = decodeURIComponent(req.url.split('/').pop());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: `http://127.0.0.1:3912/arquivo/${id}`, mime_type: 'image/jpeg', id }));
  });
  servidor(3913, (req, res, corpo) => { // Supabase Storage
    if (req.headers.authorization !== 'Bearer chave-storage-falsa') { res.writeHead(401); return res.end(); }
    if (req.method === 'GET') {
      const k = decodeURIComponent(req.url.replace('/storage/v1/object/', ''));
      if (!(k in storage.arquivos)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(storage.arquivos[k]);
    }
    storage.arquivos[decodeURIComponent(req.url.replace('/storage/v1/object/', ''))] = corpo.toString();
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  receptor = subirReceptor();
  assert.ok(await pronto(), 'receptor não subiu: ' + receptor.saida);
});

after(async () => {
  receptor?.kill('SIGTERM');
  for (const s of servidores) s.close();
  await sql.end();
});

test('verificação do webhook (GET) só com o verify token certo', async () => {
  const ok = await fetch(`${B}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token-verificacao&hub.challenge=12345`);
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '12345');
  const nao = await fetch(`${B}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.equal(nao.status, 403);
});

test('evento com assinatura errada é recusado e não é guardado', async () => {
  const r = await enviar(msgEntrada('wamid.FALSO', { type: 'text', text: { body: 'invasão' } }), { segredo: 'outro' });
  assert.equal(r.status, 401);
  assert.equal((await q("select count(*)::int n from wa_eventos where corpo like '%invasão%'"))[0].n, 0);
});

test('mensagem do paciente: guarda, repassa idêntica para a Sara e espelha', async () => {
  const evento = msgEntrada('wamid.T1', { type: 'text', text: { body: 'Oi, quero marcar consulta' } });
  const corpo = JSON.stringify(evento);
  const r = await enviar(evento);
  assert.equal(r.status, 200);
  const rep = await ate(() => n8n.recebidos.find((x) => x.corpo === corpo));
  assert.ok(rep, 'não repassou para o n8n');
  assert.equal(rep.url, '/sara'); assert.equal(rep.assinatura, assinar(corpo));
  const m = await ate(async () => (await msgs("where wamid = 'wamid.T1'"))[0]);
  assert.equal(m.direcao, 'entrada'); assert.equal(m.origem, 'contato'); assert.equal(m.texto, 'Oi, quero marcar consulta'); assert.equal(m.wa_id, PAC);
  const [c] = await q('select * from wa_contatos where wa_id = $1', [PAC]);
  assert.equal(c.nome_perfil, 'Paciente Ficticio');
  const [cv] = await q('select * from wa_conversas where wa_id = $1', [PAC]);
  assert.equal(cv.nao_lidas, 1); assert.equal(cv.ultima_direcao, 'entrada'); assert.ok(cv.ultima_entrada_em);
  assert.ok(await ate(async () => (await q("select repassado_em from wa_eventos where corpo like '%wamid.T1%'"))[0]?.repassado_em));
});

test('a Meta mandando o mesmo evento 2 vezes: um repasse e uma mensagem só', async () => {
  const evento = msgEntrada('wamid.DUP', { type: 'text', text: { body: 'duplicada' } });
  await enviar(evento); await enviar(evento);
  await ate(async () => (await msgs("where wamid = 'wamid.DUP'")).length);
  await esperar(500);
  assert.equal(n8n.recebidos.filter((x) => x.corpo.includes('wamid.DUP')).length, 1);
  assert.equal((await msgs("where wamid = 'wamid.DUP'")).length, 1);
  assert.equal((await q('select nao_lidas from wa_conversas where wa_id = $1', [PAC]))[0].nao_lidas, 2);
});

test('resposta da equipe pelo celular (eco): saída, zera as não lidas', async () => {
  await enviar(eco('wamid.E1', { type: 'text', text: { body: 'Claro! Qual o melhor dia?' }, context: { id: 'wamid.T1' } }));
  const m = await ate(async () => (await msgs("where wamid = 'wamid.E1'"))[0]);
  assert.equal(m.direcao, 'saida'); assert.equal(m.origem, 'celular'); assert.equal(m.resposta_a, 'wamid.T1');
  const [cv] = await q('select * from wa_conversas where wa_id = $1', [PAC]);
  assert.equal(cv.nao_lidas, 0); assert.equal(cv.ultima_resumo, 'Claro! Qual o melhor dia?');
  assert.ok(await ate(() => n8n.recebidos.some((x) => x.corpo.includes('smb_message_echoes'))), 'eco da equipe continua indo para a Sara');
});

test('status: entregue e lida, fora de ordem não volta; mensagem da API desconhecida vira linha', async () => {
  const st = (id, status, s = 0) => ev('messages', { statuses: [{ id, status, timestamp: ts(s), recipient_id: PAC }] });
  await enviar(st('wamid.E1', 'read', 2)); await enviar(st('wamid.E1', 'delivered', 1));
  await ate(async () => (await msgs("where wamid = 'wamid.E1' and status = 'lida'")).length);
  await esperar(600);
  assert.equal((await msgs("where wamid = 'wamid.E1'"))[0].status, 'lida');
  await enviar(st('wamid.SARA1', 'sent'));
  const s = await ate(async () => (await msgs("where wamid = 'wamid.SARA1'"))[0]);
  assert.equal(s.origem, 'api'); assert.equal(s.direcao, 'saida'); assert.equal(s.status, 'enviada');
  await enviar(st('wamid.SARA1', 'failed'));
  assert.ok(await ate(async () => (await msgs("where wamid = 'wamid.SARA1'"))[0].status === 'falhou'));
});

test('reação do paciente: aparece, troca e some quando ele tira', async () => {
  const reagir = (id, emoji) => msgEntrada(id, { type: 'reaction', reaction: { message_id: 'wamid.E1', ...(emoji !== undefined ? { emoji } : {}) } });
  await enviar(reagir('wamid.R1', '👍'));
  assert.ok(await ate(async () => (await q("select emoji from wa_reacoes where wamid = 'wamid.E1' and autor = $1", [PAC]))[0]?.emoji === '👍'));
  await enviar(reagir('wamid.R2', '❤️'));
  assert.ok(await ate(async () => (await q("select emoji from wa_reacoes where wamid = 'wamid.E1' and autor = $1", [PAC]))[0]?.emoji === '❤️'));
  await enviar(reagir('wamid.R3', ''));
  assert.ok(await ate(async () => (await q("select count(*)::int n from wa_reacoes where wamid = 'wamid.E1' and autor = $1", [PAC]))[0].n === 0));
  assert.equal((await msgs("where wamid in ('wamid.R1','wamid.R2','wamid.R3')")).length, 0, 'reação não vira mensagem');
});

test('equipe reage, edita e apaga pelo celular', async () => {
  await enviar(eco('wamid.ER', { type: 'reaction', reaction: { message_id: 'wamid.T1', emoji: '🙏' } }));
  assert.ok(await ate(async () => (await q("select emoji from wa_reacoes where wamid = 'wamid.T1' and autor = 'empresa'"))[0]?.emoji === '🙏'));
  await enviar(eco('wamid.ED', { type: 'edit', edit: { original_message_id: 'wamid.E1', message: { type: 'text', text: { body: 'Claro! Qual dia e horário?' } } } }));
  const m = await ate(async () => (await msgs("where wamid = 'wamid.E1' and editada_em is not null"))[0]);
  assert.equal(m.texto, 'Claro! Qual dia e horário?'); assert.equal(m.versoes[0].texto, 'Claro! Qual o melhor dia?');
  await enviar(eco('wamid.RV', { type: 'revoke', revoke: { original_message_id: 'wamid.E1' } }));
  assert.ok(await ate(async () => (await msgs("where wamid = 'wamid.E1'"))[0].apagada_em));
});

test('foto do paciente: guarda os dados e baixa o arquivo para o Storage', async () => {
  await enviar(msgEntrada('wamid.IMG', { type: 'image', image: { id: 'MIDIA1', mime_type: 'image/jpeg', sha256: 'x', caption: 'meu exame' } }));
  const m = await ate(async () => (await msgs("where wamid = 'wamid.IMG' and midia ? 'caminho'"))[0], 12000);
  assert.ok(m, 'mídia não foi baixada');
  assert.equal(m.texto, 'meu exame'); assert.equal(m.midia.id, 'MIDIA1');
  assert.equal(storage.arquivos[`whatsapp/${m.midia.caminho}`], 'JPEGFALSO');
});

test('tipo não suportado (enquete, visualização única) vira linha com aviso', async () => {
  await enviar(msgEntrada('wamid.UNS', { type: 'unsupported', errors: [{ code: 131051, title: 'Message type unknown' }] }));
  const m = await ate(async () => (await msgs("where wamid = 'wamid.UNS'"))[0]);
  assert.equal(m.tipo, 'unsupported'); assert.equal(m.texto, 'Message type unknown');
});

test('histórico da conexão: 2 conversas, os dois lados, sem contar como não lida e sem duplicar', async () => {
  const PAC2 = '5547911110002';
  const h = ev('history', { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [
    { id: PAC2, messages: [
      { from: PAC2, id: 'wamid.H1', timestamp: ts(-86400), type: 'text', text: { body: 'mensagem antiga do paciente' }, history_context: { status: 'READ' } },
      { from: MEU, to: PAC2, id: 'wamid.H2', timestamp: ts(-86000), type: 'text', text: { body: 'resposta antiga da clínica' }, history_context: { status: 'READ' } },
    ] },
    { id: PAC, messages: [{ from: PAC, id: 'wamid.T1', timestamp: ts(-90000), type: 'text', text: { body: 'versão do histórico' } }] },
  ] }] });
  await enviar(h);
  await ate(async () => (await msgs("where wamid = 'wamid.H2'")).length);
  const [h1] = await msgs("where wamid = 'wamid.H1'"); const [h2] = await msgs("where wamid = 'wamid.H2'");
  assert.equal(h1.direcao, 'entrada'); assert.equal(h1.origem, 'historico');
  assert.equal(h2.direcao, 'saida'); assert.equal(h2.status, 'lida');
  const [cv2] = await q('select * from wa_conversas where wa_id = $1', [PAC2]);
  assert.equal(cv2.nao_lidas, 0); assert.equal(cv2.ultima_resumo, 'resposta antiga da clínica');
  assert.equal((await msgs("where wamid = 'wamid.T1'"))[0].texto, 'Oi, quero marcar consulta', 'histórico não sobrescreve o que chegou ao vivo');
  assert.ok(!n8n.recebidos.some((x) => x.corpo.includes('wamid.H1')), 'histórico não vai para a Sara');
  assert.equal((await q("select repassar from wa_eventos where corpo like '%wamid.H1%'"))[0].repassar, false);
});

test('histórico grande (3.000 mensagens) entra inteiro e rápido', async () => {
  const threads = Array.from({ length: 30 }, (_, t) => ({ id: `55479222${String(t).padStart(5, '0')}`, messages: Array.from({ length: 100 }, (_, i) => ({
    from: i % 2 ? MEU : `55479222${String(t).padStart(5, '0')}`, id: `wamid.G${t}_${i}`, timestamp: ts(-200000 + i), type: 'text', text: { body: `m${i}` },
  })) }));
  const t0 = Date.now();
  await enviar(ev('history', { history: [{ metadata: { phase: 1, chunk_order: 1, progress: 50 }, threads }] }));
  const n = await ate(async () => { const x = (await q("select count(*)::int n from wa_mensagens where wamid like 'wamid.G%'"))[0].n; return x === 3000 ? x : 0; }, 60000);
  assert.equal(n, 3000);
  assert.ok(Date.now() - t0 < 60000);
  assert.equal((await q("select count(*)::int n from wa_conversas where wa_id like '55479222%'"))[0].n, 30);
});

test('agenda do celular: contatos adicionados e removidos', async () => {
  await enviar(ev('smb_app_state_sync', { state_sync: [
    { type: 'contact', contact: { full_name: 'Paciente Agenda', first_name: 'Paciente', phone_number: '+55 47 91111-0003' }, action: 'add', metadata: { timestamp: ts() } },
    { type: 'contact', contact: { full_name: 'Paciente Ficticio Salvo', phone_number: PAC }, action: 'add', metadata: { timestamp: ts() } },
  ] }));
  assert.ok(await ate(async () => (await q("select nome_salvo from wa_contatos where wa_id = '5547911110003'"))[0]?.nome_salvo === 'Paciente Agenda'));
  const [c] = await q('select * from wa_contatos where wa_id = $1', [PAC]);
  assert.equal(c.nome_salvo, 'Paciente Ficticio Salvo'); assert.equal(c.nome_perfil, 'Paciente Ficticio');
  await enviar(ev('smb_app_state_sync', { state_sync: [{ type: 'contact', contact: { phone_number: '5547911110003' }, action: 'remove', metadata: { timestamp: ts() } }] }));
  assert.ok(await ate(async () => (await q("select removido from wa_contatos where wa_id = '5547911110003'"))[0]?.removido === true));
  assert.ok(!n8n.recebidos.some((x) => x.corpo.includes('smb_app_state_sync')), 'agenda não vai para a Sara');
});

test('n8n fora do ar: o receptor responde 200 e repassa quando ele volta', async () => {
  n8n.falhar = true;
  await enviar(msgEntrada('wamid.N8N', { type: 'text', text: { body: 'n8n caiu' } }));
  await ate(async () => (await q("select repasse_tentativas from wa_eventos where corpo like '%wamid.N8N%'"))[0]?.repasse_tentativas >= 1);
  n8n.falhar = false;
  assert.ok(await ate(() => n8n.recebidos.some((x) => x.corpo.includes('wamid.N8N')), 20000), 'não refez o repasse');
  assert.ok(await ate(async () => (await q("select repassado_em from wa_eventos where corpo like '%wamid.N8N%'"))[0]?.repassado_em));
  assert.ok((await msgs("where wamid = 'wamid.N8N'")).length === 1, 'espelho não depende do n8n');
});

test('número não cadastrado: guarda, repassa para o padrão e espera o cadastro', async () => {
  const outro = '100000000000002';
  await enviar(ev('messages', { messages: [{ from: PAC, id: 'wamid.ORFAO', timestamp: ts(), type: 'text', text: { body: 'de outro número' } }] }, outro));
  assert.ok(await ate(() => n8n.recebidos.some((x) => x.url === '/padrao' && x.corpo.includes('wamid.ORFAO'))));
  assert.ok(await ate(async () => /não cadastrado/.test((await q("select erro from wa_eventos where corpo like '%wamid.ORFAO%'"))[0]?.erro || '')));
  assert.equal((await msgs("where wamid = 'wamid.ORFAO'")).length, 0);
});

test('banco central fora: responde 200, repassa para a Sara e guarda no spool até o banco voltar', async () => {
  const spool = path.join(os.tmpdir(), 'receptor-spool-fora');
  fs.rmSync(spool, { recursive: true, force: true });
  const fora = subirReceptor({ PORTA: 3914, CENTRAL_DATABASE_URL: 'postgres://ninguem:x@127.0.0.1:1/nada', SPOOL_DIR: spool, HOSTNAME: 'fora' });
  try {
    assert.ok(await pronto(3914));
    const r = await enviar(msgEntrada('wamid.SPOOL', { type: 'text', text: { body: 'banco caiu' } }), { porta: 3914 });
    assert.equal(r.status, 200);
    assert.ok(n8n.recebidos.some((x) => x.url === '/padrao' && x.corpo.includes('wamid.SPOOL')), 'Sara não recebeu com o banco fora');
    assert.ok(fs.readFileSync(path.join(spool, 'spool-fora.jsonl'), 'utf8').includes('wamid.SPOOL'));
  } finally { fora.kill('SIGTERM'); }
  // O banco "volta": um receptor com o mesmo volume esvazia o spool e o evento entra sem repassar de novo.
  const volta = subirReceptor({ PORTA: 3915, SPOOL_DIR: spool, HOSTNAME: 'outro-container' }); // nome novo, como num container recriado
  try {
    assert.ok(await pronto(3915));
    assert.ok(await ate(async () => (await msgs("where wamid = 'wamid.SPOOL'")).length === 1, 20000), 'spool não foi gravado');
    assert.equal(n8n.recebidos.filter((x) => x.corpo.includes('wamid.SPOOL')).length, 1, 'repassou duas vezes');
  } finally { volta.kill('SIGTERM'); }
});

test('a Sara registra o que mandou: a linha do status ganha o texto', async () => {
  const reg = (chave, corpo) => fetch(`${B}/whatsapp/envio`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-receptor-chave': chave }, body: JSON.stringify(corpo) });
  assert.equal((await reg('errada', {})).status, 401);
  const r = await reg('chave-interna-teste', { phone_number_id: NUM, to: PAC, wamid: 'wamid.SARA1', tipo: 'text', texto: 'Olá! Sou a Sara, assistente da clínica.', timestamp: ts() });
  assert.equal(r.status, 200);
  const [m] = await msgs("where wamid = 'wamid.SARA1'");
  assert.equal(m.texto, 'Olá! Sou a Sara, assistente da clínica.'); assert.equal(m.origem, 'api'); assert.equal(m.status, 'falhou', 'o status já recebido continua');
  const r2 = await reg('chave-interna-teste', { phone_number_id: NUM, to: PAC, wamid: 'wamid.SARA2', texto: 'Posso ajudar com mais algo?' });
  assert.equal(r2.status, 200);
  assert.equal((await msgs("where wamid = 'wamid.SARA2'"))[0].status, 'enviada');
});

test('saúde: mostra a fila e o atraso', async () => {
  const r = await (await fetch(`${B}/whatsapp/saude`)).json();
  assert.equal(r.ok, true); assert.equal(typeof r.pendentes, 'number'); assert.equal(typeof r.atraso_s, 'number');
});

test('aceita a assinatura de qualquer um dos apps cadastrados', async () => {
  const r = await enviar(msgEntrada('wamid.APP2', { type: 'text', text: { body: 'veio pelo outro app' } }), { segredo: SEGREDO_OUTRO_APP });
  assert.equal(r.status, 200);
  assert.equal((await q("select count(*)::int n from wa_eventos where corpo like '%veio pelo outro app%'"))[0].n, 1);
});

test('o painel registra o que a equipe mandou: origem painel e quem mandou (por)', async () => {
  const reg = (corpo) => fetch(`${B}/whatsapp/envio`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-receptor-chave': 'chave-interna-teste' }, body: JSON.stringify(corpo) });
  const r = await reg({ phone_number_id: NUM, to: PAC, wamid: 'wamid.PAINEL1', tipo: 'text', texto: 'Resposta da equipe pelo painel', timestamp: ts(), origem: 'painel', por: 'Amanda Teste' });
  assert.equal(r.status, 200);
  const [m] = await msgs("where wamid = 'wamid.PAINEL1'");
  assert.equal(m.origem, 'painel'); assert.equal(m.direcao, 'saida'); assert.equal(m.texto, 'Resposta da equipe pelo painel'); assert.equal(m.bruto.por, 'Amanda Teste');
  // O status chegou antes (linha criada como 'api'): o registro do painel corrige a origem e guarda quem mandou.
  const st = ev('messages', { statuses: [{ id: 'wamid.PAINEL2', status: 'sent', timestamp: ts(), recipient_id: PAC }] });
  await enviar(st);
  assert.ok(await ate(async () => (await msgs("where wamid = 'wamid.PAINEL2'")).length === 1));
  assert.equal((await reg({ phone_number_id: NUM, to: PAC, wamid: 'wamid.PAINEL2', texto: 'Depois do status', origem: 'painel', por: 'x'.repeat(100) })).status, 200);
  const [m2] = await msgs("where wamid = 'wamid.PAINEL2'");
  assert.equal(m2.origem, 'painel'); assert.equal(m2.texto, 'Depois do status'); assert.equal(m2.bruto.por, 'x'.repeat(80), '"por" limitado a 80 caracteres');
  // Origem desconhecida continua 'api' e não guarda "por".
  assert.equal((await reg({ phone_number_id: NUM, to: PAC, wamid: 'wamid.PAINEL3', texto: 'origem estranha', origem: 'celular', por: 'Alguém' })).status, 200);
  const [m3] = await msgs("where wamid = 'wamid.PAINEL3'");
  assert.equal(m3.origem, 'api'); assert.equal(m3.bruto.por, undefined);
});

test('a Sara pergunta quem atende: equipe assumiu, equipe no celular ou ela', async () => {
  const P3 = '554788880003';   // como a Meta manda (sem o 9)
  const P4 = '554788880004';
  const perguntar = (wa, { chave = 'chave-interna-teste', numero = NUM } = {}) =>
    fetch(`${B}/whatsapp/atendimento?numero=${numero}&wa_id=${wa}`, { headers: { 'x-receptor-chave': chave } });
  assert.equal((await perguntar(P3, { chave: 'errada' })).status, 401);
  assert.equal((await perguntar('abc')).status, 400);
  assert.equal((await perguntar(P3, { numero: '999999999999999' })).status, 404);
  // Conversa que o espelho não conhece: a Sara responde.
  let r = await (await perguntar(P3)).json();
  assert.equal(r.sara_responde, true); assert.equal(r.motivo, 'ia');

  const entrada = (wa, id) => ev('messages', { contacts: [{ profile: { name: 'Paciente Ficticio 3' }, wa_id: wa }], messages: [{ from: wa, id, timestamp: ts(), type: 'text', text: { body: 'oi' } }] });
  await enviar(entrada(P3, 'wamid.DONO1'));
  await enviar(entrada(P4, 'wamid.DONO2'));
  assert.ok(await ate(async () => (await q('select count(*)::int n from wa_conversas where wa_id = any($1)', [[P3, P4]]))[0].n === 2));
  r = await (await perguntar(P3)).json();
  assert.equal(r.sara_responde, true); assert.equal(r.dono, 'ia');

  // A equipe respondeu pelo celular agora: Sara quieta pelos minutos da pausa. Achado também com o 9.
  await enviar(ev('smb_message_echoes', { message_echoes: [{ from: MEU, to: P3, id: 'wamid.DONO3', timestamp: ts(), type: 'text', text: { body: 'Oi, aqui é a equipe' } }] }));
  assert.ok(await ate(async () => (await msgs("where wamid = 'wamid.DONO3'")).length === 1));
  r = await (await perguntar('5547988880003')).json();
  assert.equal(r.sara_responde, false); assert.equal(r.motivo, 'equipe_no_celular');
  const falta = new Date(r.pausa_ate).getTime() - Date.now();
  assert.ok(falta > 6 * 60_000 && falta <= 7 * 60_000 + 5000, 'pausa de 7 min a partir da resposta da equipe');

  // Resposta pelo celular de 10 minutos atrás já não segura a Sara.
  await enviar(ev('smb_message_echoes', { message_echoes: [{ from: MEU, to: P4, id: 'wamid.DONO4', timestamp: ts(-600), type: 'text', text: { body: 'antiga' } }] }));
  assert.ok(await ate(async () => (await msgs("where wamid = 'wamid.DONO4'")).length === 1));
  assert.equal((await (await perguntar(P4)).json()).sara_responde, true);

  // A equipe assumiu no painel: Sara quieta até devolverem, sem prazo.
  await q(`update wa_conversas set dono = 'humano', dono_em = now(), dono_por = 'Amanda Teste' where wa_id = $1`, [P4]);
  r = await (await perguntar(P4)).json();
  assert.equal(r.sara_responde, false); assert.equal(r.motivo, 'equipe_assumiu'); assert.equal(r.por, 'Amanda Teste');
  await q(`update wa_conversas set dono = 'ia', dono_em = now(), dono_por = 'Amanda Teste' where wa_id = $1`, [P4]);
  assert.equal((await (await perguntar(P4)).json()).sara_responde, true);
});

test('cadastro pelo painel: número novo com token e segredo próprios, conectar e pedir o histórico', async () => {
  const NUM2 = '100000000000002';
  const SEG2 = 'segredo-do-app-de-outro-cliente';
  await q(`insert into whatsapp_numeros (phone_number_id, waba_id, empresa_id, nome, encaminhar_url, token_cifrado, app_secret_cifrado, conectar_pedido_em, historico_pedido_em)
           values ($1, 'WABA_FICTICIA_2', 'teste', 'Número novo', 'http://127.0.0.1:3911/outro', $2, $3, now(), now())`,
    [NUM2, cifrar('token-do-numero-novo'), cifrar(SEG2)]);
  // Conectar: inscreve o app na WABA, aponta o número para o receptor e lê o nome verificado
  const [n] = await ate(async () => { const r = await q('select * from whatsapp_numeros where phone_number_id = $1 and conectado_em is not null', [NUM2]); return r.length ? r : null; }, 15000) || [];
  assert.ok(n, 'não conectou');
  assert.equal(n.conexao_erro, null); assert.equal(n.telefone, '5547900000002'); assert.equal(n.verificado_nome, 'Empresa Ficticia Dois'); assert.equal(n.conectar_pedido_em, null);
  const doNovo = graphPedidos.filter((x) => x.auth === 'Bearer token-do-numero-novo');
  assert.ok(doNovo.some((x) => x.metodo === 'POST' && x.url.includes('WABA_FICTICIA_2/subscribed_apps')), 'não inscreveu o app na WABA');
  const ov = doNovo.find((x) => x.metodo === 'POST' && x.url.endsWith(`/${NUM2}`));
  assert.ok(ov, 'não fez o override');
  const corpoOv = JSON.parse(ov.corpo);
  assert.equal(corpoOv.webhook_configuration.override_callback_uri, 'https://adm.planeelabia.com/whatsapp/webhook');
  assert.equal(corpoOv.webhook_configuration.verify_token, 'token-verificacao');
  // Histórico: agenda e depois conversas, com o token do número
  const [h] = await ate(async () => { const r = await q('select * from whatsapp_numeros where phone_number_id = $1 and historico_status is not null', [NUM2]); return r.length ? r : null; }, 15000) || [];
  assert.ok(h && h.historico_status.startsWith('pedido aceito'), h && h.historico_status);
  const hist = doNovo.filter((x) => x.url.includes('/smb_app_data')).map((x) => JSON.parse(x.corpo).sync_type);
  assert.deepEqual(hist, ['smb_app_state_sync', 'history']);
  // Evento assinado com o segredo do app do número novo é aceito e vai para o destino dele
  const evento = ev('messages', { contacts: [{ profile: { name: 'Cliente Novo' }, wa_id: '5547911119999' }], messages: [{ from: '5547911119999', id: 'wamid.NOVO1', timestamp: ts(), type: 'text', text: { body: 'oi do cliente novo' } }] }, NUM2);
  const r = await enviar(evento, { segredo: SEG2 });
  assert.equal(r.status, 200);
  assert.ok(await ate(() => n8n.recebidos.find((x) => x.url === '/outro' && x.corpo.includes('wamid.NOVO1'))), 'não repassou para o destino do número novo');
  // Token errado: o erro da Meta aparece no cadastro, sem travar
  await q(`update whatsapp_numeros set token_cifrado = $2, conectar_pedido_em = now() where phone_number_id = $1`, [NUM2, cifrar('token-errado')]);
  const [e] = await ate(async () => { const x = await q('select conexao_erro from whatsapp_numeros where phone_number_id = $1 and conexao_erro is not null', [NUM2]); return x.length ? x : null; }, 15000) || [];
  assert.ok(e && e.conexao_erro.includes('190'), e && e.conexao_erro);
});

test('link curto de mídia: entrega o arquivo enquanto vale', async () => {
  const caminho = Object.keys(storage.arquivos)[0];
  assert.ok(caminho, 'nenhum arquivo no Storage falso');
  const tok = 'tokendeteste_' + 'a'.repeat(30);
  await q(`insert into wa_midia_links (token, empresa_id, caminho, mime, expira_em) values ($1, 'teste', $2, 'image/jpeg', now() + interval '5 minutes'),
           ($3, 'teste', $2, 'image/jpeg', now() - interval '1 minute')`, [tok, caminho.replace(/^whatsapp\//, ''), tok + 'vencido']);
  const ok = await fetch(`${B}/whatsapp/midia/${tok}`);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/jpeg'); assert.equal(await ok.text(), 'JPEGFALSO');
  assert.equal((await fetch(`${B}/whatsapp/midia/${tok}vencido`)).status, 404);
  assert.equal((await fetch(`${B}/whatsapp/midia/curto`)).status, 404);
  assert.equal((await fetch(`${B}/whatsapp/midia/${'b'.repeat(40)}`)).status, 404);
});
