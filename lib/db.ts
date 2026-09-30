import 'server-only';
import { createHash } from 'node:crypto';
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
    p = new Pool({ connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
    pools.set(k, p);
  }
  return p;
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

export function bancoDaEmpresa(e: RefEmpresa | null | undefined): Pool {
  if (!e || !e.banco_url_cifrado) return banco();
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
