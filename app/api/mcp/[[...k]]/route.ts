import { NextResponse, type NextRequest } from 'next/server';
import { ErroApi, registrarErro } from '@/lib/db';
import { autenticar, chaveDoCabecalho } from '@/lib/api/auth';
import { hostDeCabecalhos } from '@/lib/empresa';
import { catalogo, RECURSOS } from '@/lib/api/recursos';
import * as s from '@/lib/api/servico';
import * as auto from '@/lib/api/automaticas';

// Conector MCP (Streamable HTTP, respostas JSON) para chats do Claude criarem e editarem o CRM.
// Chave: cabeçalho Authorization: Bearer <chave>, ou no caminho /api/mcp/<chave> para conectores
// que não permitem cabeçalho. Toda escrita fica em painel_auditoria.

export const dynamic = 'force-dynamic';

const NOMES = Object.keys(RECURSOS);
const recursoProp = { type: 'string', enum: NOMES, description: 'Qual parte do CRM: ' + NOMES.join(', ') };

const FERRAMENTAS = [
  { name: 'descrever_crm', description: 'Mostra tudo que dá para criar e editar no CRM: recursos, campos, filtros e regras. Chame primeiro.', inputSchema: { type: 'object', properties: {} } },
  { name: 'listar', description: 'Lista registros de um recurso, com filtros opcionais.', inputSchema: { type: 'object', properties: { recurso: recursoProp, filtros: { type: 'object', additionalProperties: { type: 'string' } }, limite: { type: 'number' } }, required: ['recurso'] } },
  { name: 'obter', description: 'Lê um registro pelo id.', inputSchema: { type: 'object', properties: { recurso: recursoProp, id: { type: 'string' } }, required: ['recurso', 'id'] } },
  { name: 'criar', description: 'Cria um registro. Para etapas e topicos, informe também "id" (texto curto).', inputSchema: { type: 'object', properties: { recurso: recursoProp, dados: { type: 'object' } }, required: ['recurso', 'dados'] } },
  { name: 'atualizar', description: 'Edita campos de um registro (ex.: mover atendimento de etapa, renomear etapa).', inputSchema: { type: 'object', properties: { recurso: recursoProp, id: { type: 'string' }, dados: { type: 'object' } }, required: ['recurso', 'id', 'dados'] } },
  { name: 'arquivar', description: 'Arquiva um registro (nada é apagado de vez).', inputSchema: { type: 'object', properties: { recurso: recursoProp, id: { type: 'string' } }, required: ['recurso', 'id'] } },
  { name: 'ficha_do_contato', description: 'Tudo o que o CRM sabe de um telefone: quem é (nome, final do CPF, desde quando), atendimentos abertos e recentes, notas, oportunidades do funil e as etapas do funil. Use antes de responder para não repetir oferta nem perder o contexto.', inputSchema: { type: 'object', properties: { telefone: { type: 'string', description: 'DDD + número, com ou sem 55' } }, required: ['telefone'] } },
  { name: 'mover_no_funil', description: 'Coloca o telefone numa etapa do funil comercial: move a oportunidade em aberto dele ou cria uma (e o contato, se faltar). etapa_id vem de etapas_funil na ficha.', inputSchema: { type: 'object', properties: { telefone: { type: 'string' }, etapa_id: { type: 'string' }, interesse: { type: 'string' }, valor: { type: 'number' }, nome: { type: 'string' } }, required: ['telefone', 'etapa_id'] } },
  { name: 'parar_automaticas', description: 'Para (parar=true) ou volta a liberar (parar=false) as mensagens automáticas (aniversário, lembretes, follow-up) para o telefone. Use quando o paciente pedir para não receber mais mensagens.', inputSchema: { type: 'object', properties: { telefone: { type: 'string' }, parar: { type: 'boolean' }, motivo: { type: 'string' } }, required: ['telefone', 'parar'] } },
  { name: 'registrar_envio_automatico', description: 'Registra no CRM uma mensagem automática enviada, que falhou ou foi cancelada. "chave" é única por envio: repetir atualiza em vez de duplicar.', inputSchema: { type: 'object', properties: { telefone: { type: 'string' }, tipo: { type: 'string', description: 'aniversario, lembrete_2d, lembrete_dia, followup_1h, followup_3h, followup_3d, followup_7d, followup_14d, followup_30d ou outro' }, situacao: { type: 'string', enum: ['enviado', 'falhou', 'cancelado'] }, quando: { type: 'string' }, texto: { type: 'string' }, wamid: { type: 'string' }, motivo: { type: 'string' }, servico: { type: 'object', properties: { sistema: { type: 'string' }, codigo_externo: { type: 'string' } } }, chave: { type: 'string' } }, required: ['telefone', 'tipo', 'situacao', 'chave'] } },
  { name: 'ler_config', description: 'Lê a configuração do CRM (todas ou uma chave).', inputSchema: { type: 'object', properties: { chave: { type: 'string' } } } },
  { name: 'definir_config', description: 'Cria ou altera uma configuração do CRM (ex.: termo_contato, etapas_atendimento, campos_cartao).', inputSchema: { type: 'object', properties: { chave: { type: 'string' }, valor: {} }, required: ['chave', 'valor'] } },
];

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const falha = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function chamar(chaveTexto: string | null, host: string | null, nome: string, a: Record<string, unknown>) {
  if (nome === 'descrever_crm') return catalogo();
  const chave = await autenticar(chaveTexto, host);
  const rec = String(a.recurso ?? '');
  switch (nome) {
    case 'listar': return s.listar(chave, rec, (a.filtros as Record<string, string>) ?? {}, Number(a.limite));
    case 'obter': return s.obter(chave, rec, String(a.id ?? ''));
    case 'criar': return s.criar(chave, rec, a.dados);
    case 'atualizar': return s.atualizar(chave, rec, String(a.id ?? ''), a.dados);
    case 'arquivar': return s.arquivar(chave, rec, String(a.id ?? ''));
    case 'ficha_do_contato': return s.ficha(chave, a.telefone);
    case 'mover_no_funil': return s.moverNoFunil(chave, a);
    case 'parar_automaticas': return auto.recusaAutomaticas(chave, a);
    case 'registrar_envio_automatico': return auto.registrarEnvioAutomatico(chave, a);
    case 'ler_config': return s.lerConfig(chave, a.chave ? String(a.chave) : undefined);
    case 'definir_config': return s.definirConfig(chave, String(a.chave ?? ''), a.valor);
    default: throw new ErroApi(404, `Ferramenta "${nome}" não existe.`);
  }
}

async function responder(msg: Rpc, chaveTexto: string | null, host: string | null) {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'painel-planee-crm', version: '1.0.0' },
        instructions: 'CRM do Painel Planee. Chame descrever_crm antes de criar ou editar. Nada é apagado de vez; mensagens de WhatsApp não saem por aqui.',
      });
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: FERRAMENTAS });
    case 'tools/call': {
      const nome = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      try {
        const r = await chamar(chaveTexto, host, nome, args);
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
      } catch (e) {
        const m = e instanceof ErroApi ? e.message + (e.detalhe ? ` ${JSON.stringify(e.detalhe)}` : '') : 'Erro interno.';
        if (!(e instanceof ErroApi)) registrarErro('mcp', e);
        return ok(msg.id, { content: [{ type: 'text', text: m }], isError: true });
      }
    }
    default:
      return falha(msg.id, -32601, `Método ${msg.method} não suportado.`);
  }
}

const MAX_CORPO = 256_000;
const MAX_LOTE = 20;

export async function POST(req: NextRequest, ctx: { params: Promise<{ k?: string[] }> }) {
  const k = (await ctx.params).k?.[0] ?? null;
  const chaveTexto = chaveDoCabecalho(req.headers.get('authorization')) ?? k;
  // Pedido grande demais ou lote com muitas chamadas: recusa antes de tocar no banco (auditoria 01/10, S13).
  if (Number(req.headers.get('content-length') || 0) > MAX_CORPO) return NextResponse.json(falha(null, -32600, 'Pedido grande demais.'), { status: 413 });
  let entrada: Rpc | Rpc[];
  try {
    const texto = await req.text();
    if (texto.length > MAX_CORPO) return NextResponse.json(falha(null, -32600, 'Pedido grande demais.'), { status: 413 });
    entrada = JSON.parse(texto);
  } catch { return NextResponse.json(falha(null, -32700, 'JSON inválido.'), { status: 400 }); }
  const lista = Array.isArray(entrada) ? entrada : [entrada];
  if (lista.length > MAX_LOTE) return NextResponse.json(falha(null, -32600, `No máximo ${MAX_LOTE} chamadas por lote.`), { status: 400 });
  const respostas = [];
  for (const m of lista) {
    if (m.id === undefined || m.id === null) continue; // notificação: sem resposta
    respostas.push(await responder(m, chaveTexto, hostDeCabecalhos(req.headers)));
  }
  if (!respostas.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(entrada) ? respostas : respostas[0]);
}

export async function GET() {
  return NextResponse.json({ erro: 'Use POST (MCP Streamable HTTP).' }, { status: 405 });
}
