import 'server-only';
import { bancoConfigurado, bancoDaEmpresa, registrarErro } from '@/lib/db';
import { empresaDoDominio } from '@/lib/empresa';

// Painel instalável no celular (PWA, 03/11). Cada empresa liga o dela com crm_config "app", gravado pela API:
//   { "nome": "SSA Soluções", "nome_curto": "SSA", "cor": "#0b5cab",
//     "icone_192": "data:image/png;base64,...", "icone_512": "data:image/png;base64,..." }
// Sem "app" (ou sem os dois ícones), o endereço da empresa não oferece instalar: o manifesto responde 404 e a página
// nem aponta para ele. O endereço acessado escolhe a empresa (lib/empresa.ts); nada aqui diz qual empresa usa.

export type AppInstalavel = { nome: string; nomeCurto: string; cor: string; icones: Record<'192' | '512', Buffer> };

const PNG = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const MAX_ICONE = 300 * 1024;
const MEMORIA_MS = () => { const n = Number(process.env.PAINEL_APP_CACHE_MS); return Number.isFinite(n) && n >= 0 ? n : 5 * 60_000; };
const g = globalThis as unknown as { __painelApp?: Map<string, { app: AppInstalavel | null; ate: number }> };
const memoria = (g.__painelApp ??= new Map());

function icone(v: unknown): Buffer | null {
  const m = typeof v === 'string' ? PNG.exec(v) : null;
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  // Assinatura do PNG e tamanho razoável.
  return b.length > 8 && b.length <= MAX_ICONE && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? b : null;
}

export function appDoValor(v: unknown, nomeEmpresa: string): AppInstalavel | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const i192 = icone(o.icone_192), i512 = icone(o.icone_512);
  if (!i192 || !i512) return null;
  const texto = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : '');
  const nome = texto(o.nome, 60) || nomeEmpresa;
  return { nome, nomeCurto: texto(o.nome_curto, 20) || nome.slice(0, 20), cor: typeof o.cor === 'string' && COR.test(o.cor) ? o.cor : '#111111', icones: { 192: i192, 512: i512 } };
}

export async function appDoEndereco(host: string | null): Promise<AppInstalavel | null> {
  if (!host || !bancoConfigurado()) return null;
  const agora = Date.now();
  const lembrado = memoria.get(host);
  if (lembrado && lembrado.ate > agora) return lembrado.app;
  let app: AppInstalavel | null = null;
  try {
    const e = await empresaDoDominio(host);
    if (e?.ativo) {
      const r = await bancoDaEmpresa(e).query(`select valor from crm_config where chave = 'app'`);
      app = appDoValor(r.rows[0]?.valor, e.nome);
    }
  } catch (err) {
    registrarErro('app instalável', err);
    return null; // não guarda a falha: tenta de novo no próximo pedido
  }
  if (memoria.size > 200) memoria.clear();
  memoria.set(host, { app, ate: agora + MEMORIA_MS() });
  return app;
}
