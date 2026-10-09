import { type NextRequest } from 'next/server';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { ErroApi, medicao, registrarErro, type Medida } from '@/lib/db';
import { usuarioParaLeitura } from '@/lib/sessao';
import { LEITURAS } from '@/lib/painel/leituras';

export const dynamic = 'force-dynamic';

const comprimir = promisify(gzip);
// Resposta comprimida (gzip) quando passa de 1 KB: o painel fica na Europa e a equipe no Brasil, e cada ida e volta
// custa ~0,2 s. O quadro (60 cartões) tinha 65 KB sem compressão e levava 3 idas e voltas só para chegar; comprimido
// cabe em uma (09/10). As rotas do Next não comprimem sozinhas (só as páginas e os arquivos estáticos).
const MIN_COMPRIMIR = 1024;

// GET /api/painel/ler/<recurso>?...: as leituras das telas (lib/painel/leituras.ts), no mesmo envelope das ações
// ({ok, dados} ou {ok:false, erro, sair}). Server-Timing mostra no DevTools onde foi o tempo: sessão e banco.
export async function GET(req: NextRequest, ctx: { params: Promise<{ recurso: string }> }) {
  const t0 = performance.now();
  const { recurso } = await ctx.params;
  const ler = Object.prototype.hasOwnProperty.call(LEITURAS, recurso) ? LEITURAS[recurso] : undefined;
  const m: Medida = { ms: 0, n: 0, repetidas: 0 };
  return medicao.run(m, async () => {
    let status = 200;
    let corpo: unknown;
    const u = await usuarioParaLeitura();
    const tSessao = performance.now() - t0;
    const mSessao = { ...m };
    if (!ler) { status = 404; corpo = { ok: false, erro: 'Leitura desconhecida.' }; }
    else if (!u) { status = 401; corpo = { ok: false, erro: 'Sua sessão terminou. Entre de novo.', sair: true }; }
    else {
      try {
        corpo = { ok: true, dados: await ler(u, req.nextUrl.searchParams) };
      } catch (e) {
        if (e instanceof ErroApi) { status = e.status; corpo = { ok: false, erro: e.message }; }
        else { registrarErro(`ler ${recurso}`, e); status = 500; corpo = { ok: false, erro: 'Não foi possível carregar agora. Tente de novo em instantes.' }; }
      }
    }
    const total = performance.now() - t0;
    const timing = [
      `sessao;dur=${tSessao.toFixed(0)};desc="consultas ${mSessao.n}"`,
      `banco;dur=${(m.ms - mSessao.ms).toFixed(0)};desc="consultas ${m.n - mSessao.n}${m.repetidas ? `, repetidas ${m.repetidas}` : ''}"`,
      `total;dur=${total.toFixed(0)}`,
    ].join(', ');
    const json = JSON.stringify(corpo);
    const cab: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Server-Timing': timing, Vary: 'Accept-Encoding' };
    if (json.length >= MIN_COMPRIMIR && /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
      try {
        const z = await comprimir(Buffer.from(json, 'utf8'), { level: 6 });
        return new Response(new Uint8Array(z), { status, headers: { ...cab, 'Content-Encoding': 'gzip' } });
      } catch { /* sem compressão: segue o texto puro */ }
    }
    return new Response(json, { status, headers: cab });
  });
}
