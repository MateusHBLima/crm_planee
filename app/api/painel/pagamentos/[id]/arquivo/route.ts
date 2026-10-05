import { NextResponse, type NextRequest } from 'next/server';
import { ErroApi, registrarErro } from '@/lib/db';
import { usuarioAtual } from '@/lib/sessao';
import { arquivoParaTela } from '@/lib/painel/servicos';

// Comprovante para a tela do CRM: confere a sessão, a empresa e a permissão (pagamentos.ver) a cada pedido.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioAtual();
  if (!u) return NextResponse.json({ erro: 'Sessão terminou.' }, { status: 401 });
  try {
    const a = await arquivoParaTela(u, (await ctx.params).id);
    return new NextResponse(new Uint8Array(a.dados), { headers: {
      'content-type': a.mime, 'content-disposition': `inline; filename="${encodeURIComponent(a.nome)}"`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    } });
  } catch (e) {
    if (e instanceof ErroApi) return NextResponse.json({ erro: e.message }, { status: e.status });
    registrarErro('comprovante', e);
    return NextResponse.json({ erro: 'Erro interno.' }, { status: 500 });
  }
}
