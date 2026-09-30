import { NextResponse, type NextRequest } from 'next/server';
import { ErroApi } from '@/lib/db';
import { autenticar, chaveDoCabecalho } from '@/lib/api/auth';
import { hostDeCabecalhos } from '@/lib/empresa';
import { catalogo } from '@/lib/api/recursos';
import * as s from '@/lib/api/servico';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ caminho?: string[] }> };

function erro(e: unknown) {
  if (e instanceof ErroApi) return NextResponse.json({ erro: e.message, detalhe: e.detalhe }, { status: e.status });
  console.error(e);
  return NextResponse.json({ erro: 'Erro interno.' }, { status: 500 });
}

async function corpo(req: NextRequest) {
  try { return await req.json(); } catch { throw new ErroApi(400, 'Corpo precisa ser JSON.'); }
}

async function tratar(req: NextRequest, ctx: Ctx) {
  try {
    const partes = (await ctx.params).caminho ?? [];
    if (partes.length === 0 && req.method === 'GET') return NextResponse.json(catalogo());
    const chave = await autenticar(chaveDoCabecalho(req.headers.get('authorization')), hostDeCabecalhos(req.headers));
    const [rec, id, ...resto] = partes;
    if (!rec || resto.length) throw new ErroApi(404, 'Rota não existe. Veja GET /api/v1.');

    // Atalhos para o agente de IA (docs/api.md, "Para a IA").
    if (rec === 'ficha' && !id) {
      if (req.method !== 'GET') throw new ErroApi(405, 'Use GET /api/v1/ficha?telefone=55...');
      return NextResponse.json(await s.ficha(chave, req.nextUrl.searchParams.get('telefone')));
    }
    if (rec === 'funil' && !id) {
      if (req.method !== 'POST') throw new ErroApi(405, 'Use POST /api/v1/funil com {"telefone", "etapa_id"}.');
      return NextResponse.json(await s.moverNoFunil(chave, await corpo(req)));
    }

    if (rec === 'config') {
      if (req.method === 'GET') return NextResponse.json(await s.lerConfig(chave, id));
      if (req.method === 'PUT' && id) return NextResponse.json(await s.definirConfig(chave, id, (await corpo(req))?.valor));
      throw new ErroApi(405, 'Use GET /api/v1/config[/{chave}] ou PUT /api/v1/config/{chave}.');
    }

    if (!id) {
      if (req.method === 'GET') {
        const q = Object.fromEntries(req.nextUrl.searchParams);
        const { limite, deslocamento, ...filtros } = q;
        return NextResponse.json(await s.listar(chave, rec, filtros, Number(limite), Number(deslocamento)));
      }
      if (req.method === 'POST') return NextResponse.json(await s.criar(chave, rec, await corpo(req)), { status: 201 });
    } else {
      if (req.method === 'GET') return NextResponse.json(await s.obter(chave, rec, id));
      if (req.method === 'PATCH') return NextResponse.json(await s.atualizar(chave, rec, id, await corpo(req)));
      if (req.method === 'DELETE') return NextResponse.json(await s.arquivar(chave, rec, id));
    }
    throw new ErroApi(405, 'Método não permitido nesta rota.');
  } catch (e) {
    return erro(e);
  }
}

export { tratar as GET, tratar as POST, tratar as PATCH, tratar as PUT, tratar as DELETE };
