import { NextResponse, type NextRequest } from 'next/server';
import { ErroApi, medicao, registrarErro, type Medida } from '@/lib/db';
import { usuarioParaLeitura } from '@/lib/sessao';
import { LEITURAS } from '@/lib/painel/leituras';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json(corpo, { status, headers: { 'Cache-Control': 'no-store', 'Server-Timing': timing } });
  });
}
