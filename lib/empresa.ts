import 'server-only';
import { headers } from 'next/headers';
import { bancoConfigurado, central } from '@/lib/db';

// Empresa pelo endereço acessado (decisão 26). O endereço só ESCOLHE a empresa; quem pode entrar nela
// é conferido em lib/sessao.ts a cada pedido.

export type Empresa = {
  id: string; nome: string; ativo: boolean; modulos: string[]; banco_url_cifrado: string | null;
};

export const COOKIE_EMPRESA = 'pp_empresa';

// "adm.planeelabia.com:443" → "adm.planeelabia.com". Só letras, números, ponto e hífen.
export function normalizarHost(h: string | null | undefined): string | null {
  if (!h) return null;
  const host = h.split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
}

export function hostDeCabecalhos(h: { get(n: string): string | null }): string | null {
  // x-forwarded-host primeiro: o Traefik grava ali o endereço que o navegador pediu, e o Next repassa
  // esse cabeçalho quando faz pedidos internos (em que o Host vira localhost). Não é brecha: o endereço só
  // escolhe a empresa; quem pode entrar nela continua sendo conferido pelo vínculo da pessoa.
  return normalizarHost(h.get('x-forwarded-host') || h.get('host'));
}

const CAMPOS = 'e.id, e.nome, e.ativo, e.modulos, e.banco_url_cifrado';

// Empresa dona deste domínio, ou null se o domínio não é de nenhuma (ex.: adm.planeelabia.com, localhost).
export async function empresaDoDominio(host: string | null): Promise<Empresa | null> {
  if (!host) return null;
  try {
    const r = await central().query(
      `select ${CAMPOS} from empresa_dominios d join empresas e on e.id = d.empresa_id where d.dominio = $1`, [host],
    );
    return r.rowCount ? (r.rows[0] as Empresa) : null;
  } catch (e) {
    // Banco central ainda sem a migração 004: nenhum domínio é de empresa (a API segue no banco padrão).
    if ((e as { code?: string }).code === '42P01') return null;
    throw e;
  }
}

export async function empresaPorId(id: string): Promise<Empresa | null> {
  const r = await central().query(`select ${CAMPOS} from empresas e where e.id = $1`, [id]);
  return r.rowCount ? (r.rows[0] as Empresa) : null;
}

// Nome da empresa quando o endereço acessado é o domínio dela (tela de login).
export async function nomeDoEndereco(): Promise<string | null> {
  if (!bancoConfigurado()) return null;
  try { return (await empresaDoDominio(hostDeCabecalhos(await headers())))?.nome ?? null; } catch { return null; }
}
