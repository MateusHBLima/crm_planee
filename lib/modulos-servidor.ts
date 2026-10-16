import 'server-only';
import type { Pool } from 'pg';
import { bancoDaEmpresa, empresaDoBancoPadrao, ErroApi, registrarErro, type RefEmpresa } from '@/lib/db';
import { empresaDoDominio, empresaPorId } from '@/lib/empresa';
import { MODULOS, estadoDoModulo, moduloMarcado, moduloPorId, type DefModulo, type EstadoModulo } from '@/lib/modulos';
import type { Recurso } from '@/lib/api/recursos';

// Parte do servidor dos módulos por empresa (docs/modulos.md). lib/modulos.ts descreve os módulos; aqui ficam:
//   - o que já rodou no banco de cada empresa (painel_migracoes, migração 027), com memória curta;
//   - a trava da API: rota de módulo desligado = 404; marcado sem o SQL = 409;
//   - os recursos da API e o bloco da ficha de cada módulo.

// ---- O que rodou no banco de cada empresa ----

type Migracoes = { lidas: Set<string>; dono: string | null; erro: string | null };
const MEMORIA_MS = () => { const n = Number(process.env.PAINEL_MODULOS_CACHE_MS); return Number.isFinite(n) && n >= 0 ? n : 60_000; };
// No globalThis: rotas e ações são pacotes separados, cada um com a sua cópia deste módulo (ver lib/sessao.ts).
const g = globalThis as unknown as { __painelMigracoes?: Map<string, { m: Migracoes; ate: number }> };
const memoria = (g.__painelMigracoes ??= new Map());
export function esquecerMigracoes() { memoria.clear(); }

async function lerMigracoes(db: Pool): Promise<Migracoes> {
  try {
    const r = await db.query(`select (select id from painel_empresa) as dono, coalesce(array_agg(id), '{}') as ids from painel_migracoes`);
    return { lidas: new Set((r.rows[0]?.ids as string[]) ?? []), dono: (r.rows[0]?.dono as string | null) ?? null, erro: null };
  } catch (e) {
    // Banco sem a migração 027: nenhum módulo instalado.
    if ((e as { code?: string }).code === '42P01') return { lidas: new Set(), dono: null, erro: 'sem_027' };
    throw e;
  }
}

// Migrações do banco desta empresa. Se o banco disser que é de OUTRA empresa (painel_empresa), nada conta como
// instalado: é a segunda trava contra banco trocado (a primeira é o painel_exigir_empresa no SQL do módulo).
export async function migracoesDaEmpresa(e: RefEmpresa): Promise<Migracoes> {
  const agora = Date.now();
  const lembrada = memoria.get(e.id);
  if (lembrada && lembrada.ate > agora) return lembrada.m;
  let m = await lerMigracoes(bancoDaEmpresa(e));
  if (m.dono && m.dono !== e.id) m = { lidas: new Set(), dono: m.dono, erro: 'banco_de_outra_empresa' };
  if (memoria.size > 200) memoria.clear();
  memoria.set(e.id, { m, ate: agora + MEMORIA_MS() });
  return m;
}

type EmpresaComModulos = RefEmpresa & { modulos?: readonly string[] | null };

// Situação de cada módulo do código nesta empresa. Só lê o banco da empresa se ela tiver algum módulo marcado:
// empresa sem módulo (a clínica, hoje) não paga nada.
export async function estadosDosModulos(e: EmpresaComModulos): Promise<Map<string, EstadoModulo> & { erro?: string | null }> {
  const marcados = e.modulos ?? [];
  const saida = new Map<string, EstadoModulo>() as Map<string, EstadoModulo> & { erro?: string | null };
  const algum = MODULOS.some((m) => moduloMarcado(m, marcados));
  let mig: Migracoes | null = null;
  if (algum) {
    try { mig = await migracoesDaEmpresa(e); saida.erro = mig.erro; } catch (err) {
      registrarErro('módulos: migrações da empresa', err); saida.erro = 'banco_indisponivel';
    }
  }
  for (const m of MODULOS) saida.set(m.id, estadoDoModulo(m, marcados, mig ? mig.lidas : null));
  return saida;
}

export async function modulosLigados(e: EmpresaComModulos | null): Promise<Set<string>> {
  if (!e) return new Set();
  const est = await estadosDosModulos(e);
  return new Set([...est].filter(([, v]) => v === 'ligado').map(([k]) => k));
}

// Empresa de uma operação da API: a do domínio chamado, ou a dona do banco padrão (endereço geral).
async function empresaDaOperacao(ref: EmpresaComModulos | null | undefined): Promise<EmpresaComModulos | null> {
  if (ref?.modulos) return ref;
  const id = ref?.id ?? empresaDoBancoPadrao();
  if (!id) return null;
  const e = await empresaPorId(id).catch(() => null);
  return e ? { id: e.id, banco_url_cifrado: e.banco_url_cifrado, modulos: e.modulos } : ref ?? null;
}

export async function ligadosDaOperacao(ref: EmpresaComModulos | null | undefined): Promise<Set<string>> {
  return modulosLigados(await empresaDaOperacao(ref));
}

// Módulos ligados na empresa dona deste endereço (catálogo da API e do conector, que não pedem chave).
// Falha ao ler o banco não derruba o catálogo: ele só sai sem os módulos.
export async function ligadosDoEndereco(host: string | null): Promise<Set<string>> {
  try { return await ligadosDaOperacao(await empresaDoDominio(host)); } catch (e) {
    registrarErro('módulos: catálogo', e); return new Set();
  }
}

// Trava da API para recurso e bloco de módulo.
export async function exigirModulo(ref: EmpresaComModulos | null | undefined, moduloId: string) {
  const m = moduloPorId(moduloId);
  const e = await empresaDaOperacao(ref);
  const estado = m && e ? (await estadosDosModulos(e)).get(m.id) : 'desligado';
  if (estado === 'ligado') return;
  if (estado === 'sem_migracao') {
    throw new ErroApi(409, `O módulo "${m!.nome}" está marcado para esta empresa, mas o SQL dele ainda não rodou no banco dela.`, { codigo: 'modulo_sem_migracao', modulo: m!.id });
  }
  throw new ErroApi(404, 'Recurso não existe nesta empresa. Veja GET /api/v1 para a lista.');
}

// ---- O que cada módulo acrescenta na API ----

type ParteServidor = {
  recursos: Record<string, Recurso>;
  // Bloco do módulo na ficha (GET /api/v1/ficha): contato_id -> { chave: valor }. Só roda com o módulo ligado;
  // desligado, a chave nem aparece (combinado com a V2 da Amanda em 16/10).
  ficha?: (db: Pool, contatoIds: string[]) => Promise<Map<string, Record<string, unknown>>>;
  paraIa?: string[];
};

const TESTE: ParteServidor = {
  recursos: {
    teste_notas: {
      nome: 'teste_notas', tabela: 'mod_teste_notas', chave: 'id', idTipo: 'uuid', idObrigatorioNaCriacao: false, escrita: 'crm',
      descricao: 'Notas do módulo de teste (só existe nos testes do mecanismo de módulos).',
      campos: { contato_id: 'id do contato', texto: 'texto da nota' },
      filtros: ['contato_id', 'arquivado'], ordem: 'criado_em desc', modulo: 'teste_notas',
    },
  },
  ficha: async (db, ids) => {
    const r = await db.query(`select contato_id, texto from mod_teste_notas where contato_id = any($1) and not arquivado order by criado_em`, [ids]);
    const saida = new Map<string, Record<string, unknown>>();
    for (const x of r.rows) {
      const k = String(x.contato_id);
      const atual = (saida.get(k)?.teste_notas as string[] | undefined) ?? [];
      saida.set(k, { teste_notas: [...atual, String(x.texto)] });
    }
    return saida;
  },
  paraIa: ['GET /api/v1/teste_notas — notas do módulo de teste. Escopo leitura.'],
};

const PARTES: Record<string, ParteServidor> = {
  ...(process.env.NEXT_PUBLIC_PAINEL_MODULO_TESTE === '1' ? { teste_notas: TESTE } : {}),
};

export const parteDoModulo = (id: string): ParteServidor | undefined => PARTES[id];

export function recursoDeModulo(nome: string): Recurso | undefined {
  for (const p of Object.values(PARTES)) if (Object.prototype.hasOwnProperty.call(p.recursos, nome)) return p.recursos[nome];
  return undefined;
}

export const modulosComParte = (): DefModulo[] => MODULOS.filter((m) => PARTES[m.id]);
