// Conexões: o banco central (fila de eventos e números) e o banco de dados de cada empresa (espelho).
import { createDecipheriv, createHash } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import { erroCurto, log } from './log.js';

const pools = new Map();

function poolPara(url) {
  const k = createHash('sha256').update(url).digest('hex');
  let p = pools.get(k);
  if (!p) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    p = new pg.Pool({
      connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 60000, query_timeout: 65000,
    });
    p.on('error', (e) => log('erro', 'conexão do banco caiu', { erro: erroCurto(e) }));
    pools.set(k, p);
  }
  return p;
}

export function central() {
  if (!config.centralUrl) throw new Error('Falta CENTRAL_DATABASE_URL (ou DATABASE_URL).');
  return poolPara(config.centralUrl);
}

// Mesmo formato de lib/cifra.ts do painel (AES-256-GCM, "v1:iv:tag:dados").
export function decifrar(cifrado) {
  if (!config.chaveCifra || config.chaveCifra.length < 32) throw new Error('Falta PAINEL_CHAVE_CIFRA para abrir o banco da empresa.');
  const [v, iv, tag, dados] = String(cifrado).split(':');
  if (v !== 'v1' || !iv || !tag || !dados) throw new Error('Banco da empresa cifrado em formato desconhecido.');
  const chave = createHash('sha256').update(config.chaveCifra).digest();
  const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

// Banco de dados da empresa. Sem banco próprio, só as empresas de EMPRESA_BANCO_PADRAO usam o DATABASE_URL.
export function bancoDaEmpresa(rota) {
  if (rota.banco_url_cifrado) return poolPara(decifrar(rota.banco_url_cifrado));
  if (config.empresasNoPadrao.includes(rota.empresa_id) && config.padraoUrl) return poolPara(config.padraoUrl);
  throw new Error(`Empresa ${rota.empresa_id} sem banco configurado.`);
}

export async function transacao(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function fecharTudo() {
  await Promise.all([...pools.values()].map((p) => p.end().catch(() => undefined)));
  pools.clear();
}
