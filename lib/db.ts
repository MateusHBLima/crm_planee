import 'server-only';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';
import { decifrar } from '@/lib/cifra';

// Conexões Postgres (Supabase: string do "connection pooler"). Só o servidor usa; nunca vai para o navegador.
//   central()           → banco central da Planee: empresas, domínios, pessoas, permissões (decisão 26).
//                         CENTRAL_DATABASE_URL; sem ela, o próprio DATABASE_URL (teste: tudo no mesmo banco).
//   bancoDaEmpresa(e)   → banco de dados da empresa (CRM, conversas). O endereço fica cifrado no central;
//                         empresa sem banco próprio usa o DATABASE_URL do deploy.
//   banco()             → o DATABASE_URL do deploy (banco padrão).

const pools = new Map<string, Pool>();

function poolPara(url: string): Pool {
  const k = createHash('sha256').update(url).digest('hex');
  let p = pools.get(k);
  if (!p) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    // Limites de espera: com o banco lento, a tela mostra erro em vez de travar (auditoria 01/10, I3).
    // Conexões ficam abertas por 10 min: o banco está em outra região, e abrir uma conexão nova (TCP + TLS +
    // pooler) custa várias idas e voltas. Com 30 s, quase todo clique abria conexão nova (08/10: ~1,3 s por tela).
    p = new Pool({
      connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false }, keepAlive: true,
      connectionTimeoutMillis: 8000, idleTimeoutMillis: 600000, statement_timeout: 15000, query_timeout: 20000,
    });
    // Conexão parada que cai (reinício do pooler) emite 'error'; sem este ouvinte, o Node derruba o processo (I2).
    p.on('error', (e) => registrarErro('conexão do banco', e));
    medirERepetir(p);
    pools.set(k, p);
  }
  return p;
}

// ---- Medição e nova tentativa ----
// Cada pedido (rota /api/painel/ler) mede quanto tempo passou no banco e quantas consultas fez; a resposta leva o
// cabeçalho Server-Timing, que aparece no DevTools do navegador (aba Network → Timing).
export type Medida = { ms: number; n: number; repetidas: number };
export const medicao = new AsyncLocalStorage<Medida>();

// Erros de conexão (o pooler fechou a conexão parada, rede oscilou): a consulta avulsa é repetida uma vez numa
// conexão nova. Erro de SQL ou de regra nunca é repetido. Dentro de transação (client.query) não há repetição.
const CODIGOS_CONEXAO = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004', '53300', 'XX000']);
export function erroDeConexao(e: unknown): boolean {
  const x = (e ?? {}) as { code?: string; message?: string };
  if (x.code && CODIGOS_CONEXAO.has(x.code)) return true;
  return /Connection terminated|connection timeout|timeout exceeded when trying to connect|Client has encountered a connection error|server closed the connection|max clients reached|too many clients/i.test(String(x.message ?? ''));
}

function medirERepetir(p: Pool) {
  const original = p.query.bind(p) as (...a: unknown[]) => Promise<unknown>;
  (p as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = async (...args: unknown[]) => {
    const m = medicao.getStore();
    const t0 = performance.now();
    try {
      try {
        return await original(...args);
      } catch (e) {
        if (!erroDeConexao(e)) throw e;
        if (m) m.repetidas++;
        registrarErro('conexão do banco (repetindo)', e);
        return await original(...args);
      }
    } finally {
      if (m) { m.ms += performance.now() - t0; m.n++; }
    }
  };
}

export function bancoConfigurado(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function banco(): Pool {
  if (!process.env.DATABASE_URL) throw new ErroApi(503, 'Banco não configurado: falta DATABASE_URL neste deploy.');
  return poolPara(process.env.DATABASE_URL);
}

export function central(): Pool {
  const url = process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new ErroApi(503, 'Banco central não configurado: falta CENTRAL_DATABASE_URL (ou DATABASE_URL) neste deploy.');
  return poolPara(url);
}

export type RefEmpresa = { id: string; banco_url_cifrado: string | null };

// Empresas que podem ficar no banco padrão do deploy (sem banco próprio). Qualquer outra sem banco é recusada:
// sem isso, a empresa nova enxergaria os dados de quem já está no banco padrão (auditoria 01/10, S1).
const empresasNoPadrao = () => (process.env.EMPRESA_BANCO_PADRAO ?? 'teste').split(',').map((s) => s.trim()).filter(Boolean);

// Empresa dona do banco padrão (a primeira de EMPRESA_BANCO_PADRAO): a API chamada fora do domínio de uma empresa
// grava no banco padrão, e o que vai para o banco central (avisos) fica em nome dela.
export const empresaDoBancoPadrao = (): string | null => empresasNoPadrao()[0] ?? null;

export function bancoDaEmpresa(e: RefEmpresa | null | undefined): Pool {
  if (!e) return banco();
  if (!e.banco_url_cifrado) {
    if (empresasNoPadrao().includes(e.id)) return banco();
    throw new ErroApi(503, 'O banco desta empresa ainda não foi configurado. A Planee precisa salvar o banco dela na tela Empresas.');
  }
  let url: string;
  try { url = decifrar(e.banco_url_cifrado); } catch {
    throw new ErroApi(503, `O banco da empresa "${e.id}" não pôde ser aberto (confira PAINEL_CHAVE_CIFRA).`);
  }
  return poolPara(url);
}

export async function transacao<T>(fn: (c: PoolClient) => Promise<T>, p: Pool = banco()): Promise<T> {
  const c = await p.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export class ErroApi extends Error {
  constructor(public status: number, message: string, public detalhe?: unknown) {
    super(message);
  }
}

// Log de erro sem dado pessoal: erros do Postgres trazem a linha inteira em "detail" (telefone, CPF). Fica só o
// código, a restrição e o começo da mensagem (auditoria 01/10, S12).
export function registrarErro(onde: string, e: unknown) {
  const x = (e ?? {}) as { code?: string; constraint?: string; table?: string; column?: string; message?: string; name?: string };
  console.error(`[painel] ${onde}:`, JSON.stringify({
    nome: x.name, codigo: x.code, restricao: x.constraint, tabela: x.table, coluna: x.column,
    mensagem: typeof x.message === 'string' ? x.message.replace(/\d{6,}/g, '[número]').slice(0, 200) : String(e).slice(0, 200),
  }));
}
