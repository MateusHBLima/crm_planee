import 'server-only';
import type { Pool } from 'pg';
import { central, empresaDoBancoPadrao, ErroApi, registrarErro } from '@/lib/db';
import { empresaDoDominio, empresaPorId } from '@/lib/empresa';

// De qual empresa é esta chamada da API ou do conector (23/10, pedido do SSA AUGUSTO: "de forma alguma pode misturar
// as coisas de empresas"). O endereço escolhe a empresa e o banco (decisão 26); aqui ela passa a aparecer em toda
// resposta, para quem chama conferir antes de gravar, e o cabeçalho X-Empresa trava a chamada no endereço errado.

// slug = id da empresa no banco central (ex.: neuroessentia, ssa, teste).
export type EmpresaDaApi = { slug: string | null; nome: string | null; dominio: string | null };

// Endereço de empresa → a empresa dele. Endereço geral (adm, link de teste) → a empresa dona do banco padrão.
export async function empresaDaApi(host: string | null): Promise<EmpresaDaApi> {
  try {
    const e = await empresaDoDominio(host);
    if (e) return { slug: e.id, nome: e.nome, dominio: host };
    const id = empresaDoBancoPadrao();
    const nome = id ? (await empresaPorId(id).catch(() => null))?.nome ?? null : null;
    return { slug: id, nome, dominio: host };
  } catch (e) {
    registrarErro('api: empresa do endereço', e);
    return { slug: null, nome: null, dominio: host };
  }
}

// X-Empresa: <id> — se vier e não for a empresa deste endereço, recusa antes de tocar no banco.
export function conferirEmpresaEsperada(esperada: string | null | undefined, empresa: EmpresaDaApi) {
  const e = String(esperada ?? '').trim().toLowerCase();
  if (!e) return;
  if (e !== (empresa.slug ?? '')) {
    throw new ErroApi(409, `Esta chamada é para a empresa "${e}", mas o endereço ${empresa.dominio ?? ''} é da empresa "${empresa.slug ?? 'nenhuma'}". Nada foi feito.`,
      { codigo: 'empresa_divergente', esperada: e, empresa: empresa.slug });
  }
}

// Modelo do CRM da empresa (crm_config "modelo"). Sem a chave, "clinica": é como os bancos antigos nasceram (semente 002).
export async function modeloDoCrm(db: Pool): Promise<string> {
  try {
    const r = await db.query(`select valor from crm_config where chave = 'modelo'`);
    const v = r.rows[0]?.valor;
    return typeof v === 'string' && v.trim() ? v.trim() : 'clinica';
  } catch { return 'clinica'; }
}

// Chave recusada vai para a auditoria central (empresa, endereço, rota). No máximo 1 registro por minuto
// para a mesma chave e o mesmo endereço, para quem insiste não encher a tabela.
const ultimos = new Map<string, number>();
export async function registrarChaveRecusada(empresaId: string | null, host: string | null, rota: string | null, hashChave: string) {
  const k = `${hashChave}|${host}`;
  const agora = Date.now();
  if ((ultimos.get(k) ?? 0) > agora - 60_000) return;
  ultimos.set(k, agora);
  if (ultimos.size > 5000) ultimos.clear();
  try {
    await central().query(
      `insert into central_auditoria (usuario_id, empresa_id, acao, alvo, detalhe) values (null, $1, 'api_chave_recusada', $2, $3)`,
      [empresaId, host, JSON.stringify({ rota, chave: hashChave.slice(0, 8) })]);
  } catch (e) { registrarErro('api: auditoria da chave recusada', e); }
}
