import 'server-only';
import { Pool, type PoolClient } from 'pg';

// Conexão Postgres do deploy (Supabase: string do "connection pooler").
// Só o servidor usa; nunca vai para o navegador.
let pool: Pool | null = null;

export function bancoConfigurado(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function banco(): Pool {
  if (!process.env.DATABASE_URL) throw new ErroApi(503, 'Banco não configurado: falta DATABASE_URL neste deploy.');
  if (!pool) {
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function transacao<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await banco().connect();
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
