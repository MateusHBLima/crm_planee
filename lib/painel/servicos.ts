import 'server-only';
import { bancoDaEmpresa, central, ErroApi } from '@/lib/db';
import * as api from '@/lib/api/servico';
import { atorDe, pode, type Usuario } from '@/lib/sessao';
import type { Chave } from '@/lib/api/auth';
import { auditar } from './gestao';
import { mascararTexto } from './crm';

// Histórico do paciente e serviços/pagamentos para as telas do CRM (migração 013).
// Ver serviços e comprovantes: pagamentos.ver. Conferir e registrar pagamento: pagamentos.conferir.
// Sem essas permissões, o histórico mostra só atendimentos e notas.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');

function db(u: Usuario) {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir o CRM.');
  if (!pode(u, 'crm.ver')) throw new ErroApi(403, 'Você não tem acesso ao CRM nesta empresa.');
  return bancoDaEmpresa(u.empresa);
}
function validar(id: string, o: string) { if (!UUID.test(String(id ?? ''))) throw new ErroApi(400, `${o} inválido.`); }

export type Servico = {
  id: string; tipo: string; descricao: string | null; inicio: string | null; profissional: string | null; local: string | null;
  valor: number | null; situacao: string; sistema: string | null; codigo_externo: string | null; detalhes: Record<string, unknown>;
  criado_por: string | null; criado_em: string; atualizado_em: string; atendimento_id: string | null;
};
export type Pagamento = {
  id: string; servico_id: string | null; atendimento_id: string | null; valor: number | null; pago_em: string | null; forma: string | null;
  descricao: string | null; tem_arquivo: boolean; arquivo_nome: string | null; arquivo_mime: string | null;
  analise: 'ok' | 'suspeito' | null; analise_motivos: string[]; analisado_em: string | null;
  conferido_em: string | null; conferido_por: string | null; criado_por: string | null; criado_em: string; alerta_atendimento_id: string | null;
};
export type EventoHistorico = {
  quando: string; tipo: 'atendimento' | 'nota' | 'servico' | 'pagamento'; texto: string; quem: string | null;
  ref: { tipo: 'atendimento' | 'servico' | 'pagamento'; id: string } | null; destaque?: 'alerta' | 'ok';
};
export type Historico = { eventos: EventoHistorico[]; servicos: Servico[]; pagamentos: Pagamento[]; podePagamentos: boolean; instalado: boolean };

const SITUACAO: Record<string, string> = { agendado: 'agendado', confirmado: 'confirmado', realizado: 'realizado', cancelado: 'cancelado', faltou: 'faltou' };
const reais = (v: number | null) => (v === null ? '' : 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

function limparServico(r: Record<string, unknown>): Servico {
  return {
    id: String(r.id), tipo: String(r.tipo), descricao: (r.descricao as string) ?? null, inicio: iso(r.inicio), profissional: (r.profissional as string) ?? null,
    local: (r.local as string) ?? null, valor: num(r.valor), situacao: String(r.situacao), sistema: (r.sistema as string) ?? null,
    codigo_externo: (r.codigo_externo as string) ?? null, detalhes: (r.detalhes as Record<string, unknown>) ?? {}, criado_por: (r.criado_por as string) ?? null,
    criado_em: iso(r.criado_em) as string, atualizado_em: iso(r.atualizado_em) as string, atendimento_id: (r.atendimento_id as string) ?? null,
  };
}
function limparPagamento(r: Record<string, unknown>, master: boolean): Pagamento {
  const motivos = (Array.isArray(r.analise_motivos) ? r.analise_motivos : []).map(String);
  return {
    id: String(r.id), servico_id: (r.servico_id as string) ?? null, atendimento_id: (r.atendimento_id as string) ?? null, valor: num(r.valor),
    pago_em: iso(r.pago_em), forma: (r.forma as string) ?? null,
    descricao: r.descricao ? (master ? mascararTexto(String(r.descricao)) : String(r.descricao)) : null,
    tem_arquivo: Boolean(r.arquivo_nome), arquivo_nome: (r.arquivo_nome as string) ?? null, arquivo_mime: (r.arquivo_mime as string) ?? null,
    analise: (r.analise as 'ok' | 'suspeito') ?? null, analise_motivos: master ? motivos.map(mascararTexto) : motivos, analisado_em: iso(r.analisado_em),
    conferido_em: iso(r.conferido_em), conferido_por: (r.conferido_por as string) ?? null, criado_por: (r.criado_por as string) ?? null,
    criado_em: iso(r.criado_em) as string, alerta_atendimento_id: (r.alerta_atendimento_id as string) ?? null,
  };
}

const SEL_SERVICO = `select id, tipo, descricao, inicio, profissional, local, valor, situacao, sistema, codigo_externo, detalhes, criado_por, criado_em, atualizado_em, atendimento_id from servicos`;
const SEL_PAGAMENTO = `select id, servico_id, atendimento_id, valor, pago_em, forma, descricao, arquivo_nome, arquivo_mime, analise, analise_motivos, analisado_em,
  conferido_em, conferido_por, criado_por, criado_em, alerta_atendimento_id from pagamentos`;

// Linha do tempo do paciente: atendimentos, notas e, para quem vê pagamentos, agendamentos e comprovantes.
export async function historicoContato(u: Usuario, contatoId: string): Promise<Historico> {
  validar(contatoId, 'Contato');
  const banco = db(u);
  const masc = (t: string) => (u.master ? mascararTexto(t) : t);
  const [at, notas] = await Promise.all([
    banco.query(`select a.id, a.resumo, a.aberto_em, a.aberto_por, a.assumido_em, a.responsavel, a.finalizado_em, a.etapa, t.nome as assunto
                   from atendimentos a left join crm_topicos t on t.id = a.topico_id
                  where a.contato_id = $1 and not a.arquivado and ($2::boolean or a.resumo !~ '^\\s*\\[SOMBRA\\]')
                  order by a.aberto_em desc limit 100`, [contatoId, u.master]),
    banco.query(`select id, texto, autor, criado_em from notas where alvo_tipo = 'contatos' and alvo_id = $1 and not arquivado order by criado_em desc limit 100`, [contatoId]),
  ]);
  const eventos: EventoHistorico[] = [];
  for (const a of at.rows) {
    const ref = { tipo: 'atendimento' as const, id: String(a.id) };
    const resumo = masc(String(a.resumo ?? '').replace(/^\s*\[SOMBRA\]\s*/, '')).slice(0, 160);
    eventos.push({ quando: iso(a.aberto_em) as string, tipo: 'atendimento', texto: `Atendimento aberto${a.assunto ? ` (${a.assunto})` : ''}: ${resumo}`, quem: a.aberto_por, ref });
    if (a.assumido_em) eventos.push({ quando: iso(a.assumido_em) as string, tipo: 'atendimento', texto: `Atendimento assumido${a.assunto ? ` (${a.assunto})` : ''}`, quem: a.responsavel, ref });
    if (a.finalizado_em && a.etapa === 'finalizado') eventos.push({ quando: iso(a.finalizado_em) as string, tipo: 'atendimento', texto: `Atendimento finalizado${a.assunto ? ` (${a.assunto})` : ''}`, quem: a.responsavel, ref });
  }
  for (const n of notas.rows) eventos.push({ quando: iso(n.criado_em) as string, tipo: 'nota', texto: masc(String(n.texto)), quem: n.autor, ref: null });

  const podePag = pode(u, 'pagamentos.ver');
  let servicos: Servico[] = []; let pagamentos: Pagamento[] = []; let instalado = true;
  if (podePag) {
    try {
      const [s, p] = await Promise.all([
        banco.query(`${SEL_SERVICO} where contato_id = $1 and not arquivado order by inicio desc nulls last, criado_em desc limit 100`, [contatoId]),
        banco.query(`${SEL_PAGAMENTO} where contato_id = $1 and not arquivado order by criado_em desc limit 100`, [contatoId]),
      ]);
      servicos = s.rows.map(limparServico);
      pagamentos = p.rows.map((x) => limparPagamento(x, u.master));
    } catch (e) {
      if (!semTabela(e)) throw e;
      instalado = false;
    }
    const nomeServ = new Map(servicos.map((x) => [x.id, x]));
    for (const s of servicos) {
      const quando = s.inicio ? ` para ${new Date(s.inicio).toLocaleString('pt-BR', { timeZone: process.env.PAINEL_FUSO || 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '';
      eventos.push({ quando: s.criado_em, tipo: 'servico', texto: `${s.tipo} agendado${quando}${s.profissional ? ' · ' + s.profissional : ''}`, quem: s.criado_por, ref: { tipo: 'servico', id: s.id } });
      if (s.situacao !== 'agendado' && s.atualizado_em !== s.criado_em) {
        eventos.push({ quando: s.atualizado_em, tipo: 'servico', texto: `${s.tipo}: ${SITUACAO[s.situacao] ?? s.situacao}`, quem: null, ref: { tipo: 'servico', id: s.id } });
      }
    }
    for (const p of pagamentos) {
      const sv = p.servico_id ? nomeServ.get(p.servico_id) : undefined;
      const ref = sv ? { tipo: 'servico' as const, id: sv.id } : { tipo: 'pagamento' as const, id: p.id };
      eventos.push({ quando: p.criado_em, tipo: 'pagamento', texto: `Comprovante recebido${p.valor !== null ? ' · ' + reais(p.valor) : ''}${sv ? ` · ${sv.tipo}` : ''}${p.descricao ? ' · ' + p.descricao : ''}`, quem: p.criado_por, ref });
      if (p.analise === 'suspeito' && p.analisado_em) eventos.push({ quando: p.analisado_em, tipo: 'pagamento', texto: `Comprovante suspeito: ${p.analise_motivos.join('; ') || 'sem motivo informado'}`, quem: 'Análise da IA', ref, destaque: 'alerta' });
      if (p.conferido_em) eventos.push({ quando: p.conferido_em, tipo: 'pagamento', texto: 'Comprovante conferido', quem: p.conferido_por, ref, destaque: 'ok' });
    }
  }
  eventos.sort((x, y) => y.quando.localeCompare(x.quando));
  return { eventos, servicos, pagamentos, podePagamentos: podePag, instalado };
}

// Detalhe do agendamento: tudo do serviço e os comprovantes dele.
export async function detalheServico(u: Usuario, id: string): Promise<{ servico: Servico; pagamentos: Pagamento[] }> {
  validar(id, 'Serviço');
  if (!pode(u, 'pagamentos.ver')) throw new ErroApi(403, 'Você não tem acesso aos agendamentos e comprovantes nesta empresa.');
  const banco = db(u);
  const s = await banco.query(`${SEL_SERVICO} where id = $1`, [id]).catch((e) => { if (semTabela(e)) throw new ErroApi(503, 'Agendamentos ainda não instalados nesta empresa.'); throw e; });
  if (!s.rowCount) throw new ErroApi(404, 'Agendamento não encontrado.');
  const p = await banco.query(`${SEL_PAGAMENTO} where servico_id = $1 and not arquivado order by criado_em`, [id]);
  return { servico: limparServico(s.rows[0]), pagamentos: p.rows.map((x) => limparPagamento(x, u.master)) };
}

// Quem confere age em nome próprio, com o escopo "crm" mesmo sem crm.editar.
function atorConferir(u: Usuario): Chave {
  if (!pode(u, 'pagamentos.conferir')) throw new ErroApi(403, 'Você não tem permissão para conferir comprovantes nesta empresa.');
  const a = atorDe(u);
  return { ...a, escopos: [...new Set([...a.escopos, 'leitura', 'crm'])] };
}

export async function conferir(u: Usuario, pagamentoId: string, sim: boolean) {
  db(u);
  await api.conferirPagamento(atorConferir(u), pagamentoId, sim);
}

// Registrar pagamento pela tela (quando o comprovante chegou por outro caminho).
export async function registrarPagamento(u: Usuario, contatoId: string, form: FormData) {
  validar(contatoId, 'Contato');
  db(u);
  const ator = atorConferir(u);
  const arquivo = form.get('arquivo');
  let arq: { nome: string; mime: string; base64: string } | undefined;
  if (arquivo && typeof arquivo === 'object' && 'arrayBuffer' in arquivo && (arquivo as File).size > 0) {
    const f = arquivo as File;
    if (f.size > 10 * 1024 * 1024) throw new ErroApi(413, 'Arquivo até 10 MB.');
    arq = { nome: f.name, mime: f.type, base64: Buffer.from(await f.arrayBuffer()).toString('base64') };
  }
  const servico = String(form.get('servico_id') || '');
  const pagoEm = String(form.get('pago_em') || '');
  return api.criarPagamento(ator, {
    contato_id: contatoId, servico_id: servico || undefined,
    valor: ((v) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v))(String(form.get('valor') || '').trim()) || undefined,
    pago_em: pagoEm ? `${pagoEm}T12:00:00-03:00` : undefined,
    forma: String(form.get('forma') || '') || undefined,
    descricao: String(form.get('descricao') || '') || undefined,
    arquivo: arq, criado_por: u.nome,
  });
}

// Arquivo para a tela (rota /api/painel/pagamentos/{id}/arquivo). A Planee (master) abrir fica na auditoria central.
export async function arquivoParaTela(u: Usuario, pagamentoId: string) {
  validar(pagamentoId, 'Pagamento');
  if (!pode(u, 'pagamentos.ver')) throw new ErroApi(403, 'Sem acesso aos comprovantes nesta empresa.');
  db(u);
  const a = await api.arquivoDoPagamento({ ...atorDe(u), escopos: ['leitura'] }, pagamentoId);
  if (u.master && u.empresa) await auditar(central(), u, u.empresa.id, 'abrir_comprovante', pagamentoId, undefined).catch(() => undefined);
  return a;
}
