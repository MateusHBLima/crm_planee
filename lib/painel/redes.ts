import 'server-only';
import { randomUUID } from 'node:crypto';
import { segredoN8n } from '@/lib/integracoes';
import { bancoDaEmpresa, central, ErroApi, registrarErro, transacao } from '@/lib/db';
import { pode, type Usuario } from '@/lib/sessao';
import { gravarMensagemNaConversa } from '@/lib/api/redes';
import { fuso } from './crm';
import { auditar } from './gestao';

// Redes sociais na Inbox (migração 034, 23/11). Seletor no topo da Inbox: WhatsApp (tabelas wa_*) ou uma conta de
// rede social (tabelas rs_*). Só quem tem redes.ver vê as redes; a secretária fica no WhatsApp.
// Quem grava os directs é o n8n da empresa (POST /api/v1/redes/mensagens). A resposta escrita aqui vai para o
// webhook do n8n da conta (rs_contas.responder_url), que envia pela rede e devolve o id da mensagem.

export type ContaRede = { id: string; rede: string; usuario: string | null; nome: string | null; nao_lidas: number; responder: boolean };
export type ConversaRede = {
  conta_id: string; pessoa_id: string; usuario: string | null; nome: string | null;
  ultima_em: string | null; ultima_resumo: string | null; ultima_direcao: string | null;
  nao_lidas: number; janela_aberta: boolean; lida_por: string | null; lida_em: string | null;
};
export type MensagemRede = {
  id: string; direcao: 'entrada' | 'saida'; origem: 'contato' | 'ia' | 'painel' | 'app'; por: string | null;
  tipo: string; texto: string | null; midia_url: string | null; em: string;
};
export type ListaRede = { conta: ContaRede; conversas: ConversaRede[]; fuso: string; agente: string };
export type ConversaRedeAberta = { conversa: ConversaRede; mensagens: MensagemRede[]; temMais: boolean };

const JANELA_MS = 24 * 60 * 60 * 1000;
const POR_PAGINA = 100;
const ID = /^[A-Za-z0-9_.:@-]{1,200}$/;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');

function db(u: Usuario, permissao: 'redes.ver' | 'redes.responder' = 'redes.ver') {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir a inbox.');
  if (!pode(u, permissao)) throw new ErroApi(403, permissao === 'redes.ver' ? 'Você não tem acesso às redes sociais nesta empresa.' : 'Sua conta não pode responder nas redes sociais.');
  return bancoDaEmpresa(u.empresa);
}
async function consultar<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (semTabela(e)) throw new ErroApi(503, 'As redes sociais ainda não foram instaladas no banco desta empresa (migração 034).');
    throw e;
  }
}
function validar(...ids: string[]) { for (const x of ids) if (!ID.test(x)) throw new ErroApi(400, 'Conversa inválida.'); }

const conta = (x: Record<string, unknown>): ContaRede => ({
  id: String(x.id), rede: String(x.rede), usuario: x.usuario == null ? null : String(x.usuario), nome: x.nome == null ? null : String(x.nome),
  nao_lidas: Number(x.nao_lidas ?? 0), responder: Boolean(x.responder),
});
const conversa = (x: Record<string, unknown>): ConversaRede => ({
  conta_id: String(x.conta_id), pessoa_id: String(x.pessoa_id), usuario: x.usuario == null ? null : String(x.usuario),
  nome: x.nome == null ? null : String(x.nome), ultima_em: iso(x.ultima_em), ultima_resumo: x.ultima_resumo == null ? null : String(x.ultima_resumo),
  ultima_direcao: x.ultima_direcao == null ? null : String(x.ultima_direcao), nao_lidas: Number(x.nao_lidas ?? 0),
  janela_aberta: Boolean(x.ultima_entrada_em) && Date.now() - new Date(x.ultima_entrada_em as string).getTime() < JANELA_MS,
  lida_por: x.lida_por == null ? null : String(x.lida_por), lida_em: iso(x.lida_em),
});

// Contas para o seletor. Sem permissão ou sem a 034 no banco: lista vazia (o seletor nem aparece).
export async function contasDaInbox(u: Usuario): Promise<ContaRede[]> {
  if (!u.empresa || !pode(u, 'redes.ver')) return [];
  try {
    const r = await bancoDaEmpresa(u.empresa).query(
      `select c.id, c.rede, c.usuario, c.nome, c.responder_url is not null as responder,
              coalesce((select sum(nao_lidas) from rs_conversas k where k.conta_id = c.id and not k.arquivada), 0) as nao_lidas
         from rs_contas c where c.ativa and c.rede in ('instagram', 'facebook') order by c.rede, c.criado_em`);
    return r.rows.map(conta);
  } catch (e) {
    if (semTabela(e)) return [];
    registrarErro('redes: contas da inbox', e);
    return [];
  }
}

async function lerConta(banco: ReturnType<typeof db>, contaId: string): Promise<ContaRede> {
  const r = await consultar(() => banco.query(
    `select c.id, c.rede, c.usuario, c.nome, c.responder_url is not null as responder,
            coalesce((select sum(nao_lidas) from rs_conversas k where k.conta_id = c.id and not k.arquivada), 0) as nao_lidas
       from rs_contas c where c.id = $1 and c.ativa`, [contaId]));
  if (!r.rowCount) throw new ErroApi(404, 'Conta de rede social não encontrada nesta empresa.');
  return conta(r.rows[0]);
}

export async function listarConversasRede(u: Usuario, contaId: string, busca?: string | null): Promise<ListaRede> {
  validar(contaId);
  const banco = db(u);
  const c = await lerConta(banco, contaId);
  const b = (busca ?? '').trim().slice(0, 80);
  const r = await consultar(() => banco.query(
    `select * from rs_conversas where conta_id = $1 and not arquivada
        and ($2 = '' or usuario ilike '%' || $2 || '%' or nome ilike '%' || $2 || '%')
      order by ultima_em desc nulls last limit 300`, [contaId, b.replace(/[%_\\]/g, '')]));
  const ag = await banco.query(`select valor from crm_config where chave = 'agente'`).catch(() => ({ rows: [] as { valor?: { nome?: string } }[] }));
  return { conta: c, conversas: r.rows.map(conversa), fuso: fuso(), agente: String(ag.rows[0]?.valor?.nome ?? 'IA') };
}

async function resumo(banco: ReturnType<typeof db>, contaId: string, pessoaId: string): Promise<ConversaRede> {
  const r = await consultar(() => banco.query('select * from rs_conversas where conta_id = $1 and pessoa_id = $2', [contaId, pessoaId]));
  if (!r.rowCount) throw new ErroApi(404, 'Conversa não encontrada.');
  return conversa(r.rows[0]);
}

// Abrir a conversa marca como lida (a equipe; o master só olha), como no WhatsApp.
export async function lerConversaRede(u: Usuario, contaId: string, pessoaId: string, antesDeId?: string | null, opcoes: { marcar?: boolean } = {}): Promise<ConversaRedeAberta> {
  validar(contaId, pessoaId);
  const banco = db(u);
  if (opcoes.marcar && !u.master) {
    await consultar(() => banco.query(
      `update rs_conversas set nao_lidas = 0, lida_ate = now(), lida_por = $3, lida_em = now()
        where conta_id = $1 and pessoa_id = $2 and (nao_lidas <> 0 or lida_ate is null or lida_ate < ultima_em)`, [contaId, pessoaId, u.nome]));
  }
  const antes = antesDeId && /^\d{1,18}$/.test(antesDeId) ? antesDeId : null;
  const r = await consultar(() => banco.query(
    `select id, direcao, origem, por, tipo, texto, midia_url, enviada_em from rs_mensagens
      where conta_id = $1 and pessoa_id = $2 and ($3::bigint is null or id < $3)
      order by enviada_em desc, id desc limit ${POR_PAGINA + 1}`, [contaId, pessoaId, antes]));
  const linhas = r.rows.slice(0, POR_PAGINA).reverse();
  if (u.master && u.empresa && !antes) {
    await auditar(central(), u, u.empresa.id, 'abrir_conversa_rede', `${contaId}:${pessoaId.slice(-4)}`, undefined).catch(() => undefined);
  }
  return {
    conversa: await resumo(banco, contaId, pessoaId),
    mensagens: linhas.map((x) => ({
      id: String(x.id), direcao: x.direcao, origem: x.origem, por: x.por ?? null, tipo: String(x.tipo),
      texto: x.texto ?? null, midia_url: x.midia_url ?? null, em: new Date(x.enviada_em).toISOString(),
    })),
    temMais: r.rows.length > POR_PAGINA,
  };
}

const ENVIO_MS = 15000;
const MAX_TEXTO = 1000; // o direct do Instagram aceita até 1.000 bytes de texto
export const MSG_FORA_DA_JANELA_REDE = 'Fora da janela de 24 h: a rede só deixa responder até 24 h depois da última mensagem da pessoa. Responda pelo app.';

// Resposta pelo painel: vai ao webhook do n8n da conta, que envia pela rede e devolve {mid}. O painel grava a
// mensagem na hora (o eco que o n8n mandar depois, com o mesmo mid, não duplica). Toda tentativa vai para a
// auditoria central, sem o texto.
export async function enviarNaRede(u: Usuario, contaId: string, pessoaId: string, texto: string): Promise<{ id: string }> {
  validar(contaId, pessoaId);
  const banco = db(u, 'redes.responder');
  const t = String(texto ?? '').trim();
  if (!t) throw new ErroApi(400, 'Escreva a resposta antes de enviar.');
  if (Buffer.byteLength(t, 'utf8') > MAX_TEXTO) throw new ErroApi(400, 'Resposta longa demais para o direct (até 1.000 bytes; acento e emoji contam mais).');
  const k = await resumo(banco, contaId, pessoaId);
  if (!k.janela_aberta) throw new ErroApi(409, MSG_FORA_DA_JANELA_REDE);
  const cfg = await consultar(() => banco.query('select rede, conta_externa, responder_url from rs_contas where id = $1 and ativa', [contaId]));
  const url = cfg.rows[0]?.responder_url as string | undefined;
  if (!url) throw new ErroApi(503, 'Esta conta ainda não tem o envio ligado no n8n. Avise a Planee.');
  const segredo = await segredoN8n(u.empresa!.id);
  if (!segredo) throw new ErroApi(503, 'Falta o segredo do n8n da empresa (tela Empresas).');
  const envio = randomUUID();
  const ctrl = new AbortController(); const tempo = setTimeout(() => ctrl.abort(), ENVIO_MS);
  let mid: string | null = null;
  let falha: string | null = null;
  try {
    const x = await fetch(url, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-painel-segredo': segredo },
      body: JSON.stringify({
        evento: 'responder', empresa: u.empresa!.id, rede: cfg.rows[0].rede, conta_id: cfg.rows[0].conta_externa,
        pessoa_id: pessoaId, texto: t, id_envio: envio, por: u.nome,
      }),
    });
    const j = (await x.json().catch(() => null)) as { mid?: unknown; erro?: unknown } | null;
    if (x.ok && typeof j?.mid === 'string' && ID.test(j.mid)) mid = j.mid;
    else falha = typeof j?.erro === 'string' ? j.erro.slice(0, 200) : `O envio respondeu ${x.status}.`;
  } catch (e) {
    falha = (e as { name?: string }).name === 'AbortError' ? 'O envio demorou demais. Confira no app antes de tentar de novo.' : 'Não foi possível falar com o envio agora.';
    if ((e as { name?: string }).name !== 'AbortError') registrarErro('redes: enviar', e);
  } finally { clearTimeout(tempo); }
  await auditar(central(), u, u.empresa!.id, 'responder_rede', `${contaId}:${pessoaId.slice(-4)}`, { ok: Boolean(mid), envio }).catch(() => undefined);
  if (!mid) throw new ErroApi(502, `Não enviado: ${falha}`);
  const r = await transacao((c) => gravarMensagemNaConversa(c, {
    contaId, pessoa: { id: pessoaId }, mid: mid!, direcao: 'saida', origem: 'painel', por: u.nome, tipo: 'texto', texto: t, enviadaEm: new Date().toISOString(),
  }), banco);
  return { id: r.id };
}
