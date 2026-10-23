import { NextResponse, type NextRequest } from 'next/server';
import { bancoDaEmpresa, ErroApi, registrarErro } from '@/lib/db';
import { autenticar, chaveDoCabecalho } from '@/lib/api/auth';
import { empresaDoDominio, hostDeCabecalhos } from '@/lib/empresa';
import { conferirEmpresaEsperada, empresaDaApi, modeloDoCrm, type EmpresaDaApi } from '@/lib/api/empresa-api';
import { ligadosDoEndereco } from '@/lib/modulos-servidor';
import { catalogo } from '@/lib/api/recursos';
import * as s from '@/lib/api/servico';
import * as auto from '@/lib/api/automaticas';
import { carregarPessoas } from '@/lib/api/pessoas';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ caminho?: string[] }> };

function erro(e: unknown, empresa: EmpresaDaApi | null) {
  const h = cabecalhoEmpresa(empresa);
  if (e instanceof ErroApi) return NextResponse.json({ erro: e.message, detalhe: e.detalhe }, { status: e.status, headers: h });
  registrarErro('api', e);
  return NextResponse.json({ erro: 'Erro interno.' }, { status: 500, headers: h });
}

// X-Painel-Empresa em toda resposta: quem chama vê de qual empresa veio, mesmo num erro (23/10).
const cabecalhoEmpresa = (e: EmpresaDaApi | null): Record<string, string> => (e?.slug ? { 'x-painel-empresa': e.slug } : {});

// Respostas de leitura que dizem a empresa no topo: catálogo, ficha e config.
const comEmpresa = (empresa: EmpresaDaApi, r: unknown) =>
  r && typeof r === 'object' && !Array.isArray(r) ? { empresa, ...(r as Record<string, unknown>) } : { empresa, valor: r };

async function corpo(req: NextRequest) {
  try { return await req.json(); } catch { throw new ErroApi(400, 'Corpo precisa ser JSON.'); }
}

async function tratar(req: NextRequest, ctx: Ctx) {
  let empresa: EmpresaDaApi | null = null;
  try {
    const partes = (await ctx.params).caminho ?? [];
    const host = hostDeCabecalhos(req.headers);
    empresa = await empresaDaApi(host);
    // X-Empresa: <slug> (23/10): se o endereço for de outra empresa, recusa antes de tocar no banco.
    conferirEmpresaEsperada(req.headers.get('x-empresa'), empresa);
    const json = (r: unknown, init?: { status?: number }) => NextResponse.json(r, { ...init, headers: cabecalhoEmpresa(empresa) });
    // Catálogo sem chave: lista os recursos dos módulos ligados na empresa deste endereço (docs/modulos.md),
    // no modelo do CRM dela (fora da clínica, sem agendamento, protocolo nem "paciente").
    if (partes.length === 0 && req.method === 'GET') {
      const modelo = await modeloDoCrm(bancoDaEmpresa(await empresaDoDominio(host)));
      return json(catalogo(await ligadosDoEndereco(host), modelo, empresa));
    }
    const chave = await autenticar(chaveDoCabecalho(req.headers.get('authorization')), host, `${req.method} /api/v1/${partes.join('/')}`.slice(0, 200));
    const [rec, id, ...resto] = partes;
    // Arquivo do comprovante: GET /api/v1/pagamentos/{id}/arquivo (escopo leitura).
    if (rec === 'pagamentos' && id && resto.length === 1 && resto[0] === 'arquivo') {
      if (req.method !== 'GET') throw new ErroApi(405, 'Use GET.');
      const a = await s.arquivoDoPagamento(chave, id);
      return new NextResponse(new Uint8Array(a.dados), { headers: {
        'content-type': a.mime, 'content-disposition': `inline; filename="${encodeURIComponent(a.nome)}"`, 'cache-control': 'private, no-store',
      } });
    }
    if (!rec || resto.length) throw new ErroApi(404, 'Rota não existe. Veja GET /api/v1.');
    if (rec === 'servicos' && id === 'registrar') {
      if (req.method !== 'POST') throw new ErroApi(405, 'Use POST /api/v1/servicos/registrar.');
      return json(await s.registrarServico(chave, await corpo(req)));
    }

    // Atalhos para o agente de IA (docs/api.md, "Para a IA").
    if (rec === 'ficha' && !id) {
      if (req.method !== 'GET') throw new ErroApi(405, 'Use GET /api/v1/ficha?telefone=55...');
      return json(comEmpresa(empresa, await s.ficha(chave, req.nextUrl.searchParams.get('telefone'))));
    }
    // Mensagens automáticas da IA (migração 017): recusa do contato e registro de cada envio.
    if (rec === 'automaticas' && (id === 'recusa' || id === 'envios')) {
      if (req.method !== 'POST') throw new ErroApi(405, `Use POST /api/v1/automaticas/${id}.`);
      return json(id === 'recusa' ? await auto.recusaAutomaticas(chave, await corpo(req)) : await auto.registrarEnvioAutomatico(chave, await corpo(req)));
    }
    // Várias pessoas no mesmo número (migração 024): carga do "Quem é quem" da IA, até 500 por chamada.
    if (rec === 'pessoas' && id === 'lote') {
      if (req.method !== 'POST') throw new ErroApi(405, 'Use POST /api/v1/pessoas/lote.');
      return json(await carregarPessoas(chave, await corpo(req)));
    }
    if (rec === 'funil' && !id) {
      if (req.method !== 'POST') throw new ErroApi(405, 'Use POST /api/v1/funil com {"telefone", "etapa_id"}.');
      return json(await s.moverNoFunil(chave, await corpo(req)));
    }

    if (rec === 'config') {
      if (req.method === 'GET') return json(comEmpresa(empresa, await s.lerConfig(chave, id)));
      if (req.method === 'PUT' && id) return json(await s.definirConfig(chave, id, (await corpo(req))?.valor));
      throw new ErroApi(405, 'Use GET /api/v1/config[/{chave}] ou PUT /api/v1/config/{chave}.');
    }

    if (!id) {
      if (req.method === 'GET') {
        const q = Object.fromEntries(req.nextUrl.searchParams);
        const { limite, deslocamento, ...filtros } = q;
        return json(await s.listar(chave, rec, filtros, Number(limite), Number(deslocamento)));
      }
      if (req.method === 'POST') {
        const r = await s.criar(chave, rec, await corpo(req));
        return json(r, { status: (r as { repetido?: boolean })?.repetido ? 200 : 201 });
      }
    } else {
      if (req.method === 'GET') return json(await s.obter(chave, rec, id));
      if (req.method === 'PATCH') return json(await s.atualizar(chave, rec, id, await corpo(req)));
      if (req.method === 'DELETE') return json(await s.arquivar(chave, rec, id));
    }
    throw new ErroApi(405, 'Método não permitido nesta rota.');
  } catch (e) {
    return erro(e, empresa);
  }
}

export { tratar as GET, tratar as POST, tratar as PATCH, tratar as PUT, tratar as DELETE };
