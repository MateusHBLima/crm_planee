import 'server-only';
import { bancoDaEmpresa, central, ErroApi, registrarErro } from '@/lib/db';
import { pode, type Usuario } from '@/lib/sessao';
import { auditar } from './gestao';

// Aba "Dúvidas" (módulo duvidas, 03/11). A equipe pergunta sobre os sistemas da empresa e quem responde é o agente da
// própria empresa no n8n, no endereço de crm_config "duvidas".url (o painel não chama modelo de IA).
// Pedido ao agente (POST, cabeçalho x-painel-segredo = N8N_WEBHOOK_SEGREDO):
//   { empresa, usuario: { id, nome }, pode_ver_valores, pergunta, historico: [{ pergunta, resposta }] (até 10), id_pergunta }
// Resposta esperada: { resposta: "texto", erro: null | "indisponivel" | "sem_permissao" }. Com erro, a tela mostra a
// resposta assim mesmo (o agente manda uma frase pronta). Sem resposta em 60 s, a tela mostra que não respondeu.
// Preço: pode_ver_valores vem da permissão m.duvidas.valores; quem trava o preço é o agente (combinado em 30/10).

export type Duvida = { id: string; pergunta: string; resposta: string | null; erro: string | null; criado_em: string; respondido_em: string | null };

const MAX_PERGUNTA = 2000;
const MAX_RESPOSTA = 8000;
const HISTORICO = 10;
const LIMITE_MS = () => { const n = Number(process.env.PAINEL_DUVIDAS_LIMITE_MS); return Number.isFinite(n) && n > 0 ? n : 60_000; };
const URL_OK = /^https?:\/\/[^\s]+$/;
const ERRO_OK = /^[a-z_]{1,40}$/;

function db(u: Usuario) {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir as Dúvidas.');
  if (!pode(u, 'm.duvidas.ver')) throw new ErroApi(403, 'Você não tem acesso às Dúvidas nesta empresa.');
  return bancoDaEmpresa(u.empresa);
}

const linha = (x: Record<string, unknown>): Duvida => ({
  id: String(x.id), pergunta: String(x.pergunta), resposta: x.resposta == null ? null : String(x.resposta),
  erro: x.erro == null ? null : String(x.erro),
  criado_em: new Date(x.criado_em as string).toISOString(),
  respondido_em: x.respondido_em ? new Date(x.respondido_em as string).toISOString() : null,
});

// As últimas 50 perguntas da própria pessoa (cada um vê só as suas), da mais antiga para a mais nova.
export async function minhasDuvidas(u: Usuario): Promise<Duvida[]> {
  const r = await db(u).query(
    `select id, pergunta, resposta, erro, criado_em, respondido_em from mod_duvidas
      where usuario_id = $1 order by criado_em desc limit 50`, [u.id]);
  return r.rows.reverse().map(linha);
}

export async function perguntar(u: Usuario, texto: unknown): Promise<Duvida> {
  const banco = db(u);
  const pergunta = String(texto ?? '').trim();
  if (!pergunta) throw new ErroApi(400, 'Escreva a pergunta antes de enviar.');
  if (pergunta.length > MAX_PERGUNTA) throw new ErroApi(400, 'A pergunta passou de 2.000 caracteres.');

  const cfg = await banco.query(`select valor from crm_config where chave = 'duvidas'`).catch(() => ({ rows: [] as { valor?: unknown }[] }));
  const url = (cfg.rows[0]?.valor as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string' || !URL_OK.test(url)) throw new ErroApi(503, 'O agente das Dúvidas ainda não foi ligado nesta empresa. Avise a Planee.');
  const segredo = process.env.N8N_WEBHOOK_SEGREDO;
  if (!segredo) throw new ErroApi(503, 'As Dúvidas ainda não foram configuradas (falta N8N_WEBHOOK_SEGREDO na stack do painel).');

  const anteriores = await banco.query(
    `select pergunta, resposta from mod_duvidas
      where usuario_id = $1 and resposta is not null and erro is null order by criado_em desc limit ${HISTORICO}`, [u.id]);
  const valores = pode(u, 'm.duvidas.valores');
  const ins = await banco.query(
    `insert into mod_duvidas (usuario_id, usuario_nome, pergunta, pode_ver_valores) values ($1, $2, $3, $4) returning id`,
    [u.id, u.nome, pergunta, valores]);
  const id = String(ins.rows[0].id);

  let resposta = '';
  let erro: string | null = null;
  const ctrl = new AbortController();
  const tempo = setTimeout(() => ctrl.abort(), LIMITE_MS());
  try {
    const x = await fetch(url, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-painel-segredo': segredo },
      body: JSON.stringify({
        empresa: u.empresa!.id, usuario: { id: u.id, nome: u.nome }, pode_ver_valores: valores, pergunta,
        historico: anteriores.rows.reverse().map((a) => ({ pergunta: String(a.pergunta), resposta: String(a.resposta) })),
        id_pergunta: id,
      }),
    });
    const j = (await x.json().catch(() => null)) as { resposta?: unknown; erro?: unknown } | null;
    resposta = typeof j?.resposta === 'string' ? j.resposta.trim().slice(0, MAX_RESPOSTA) : '';
    erro = j?.erro == null || j.erro === false ? null : (ERRO_OK.test(String(j.erro)) ? String(j.erro) : 'indisponivel');
    if (!x.ok && !erro) erro = 'indisponivel';
    if (!resposta) {
      erro = erro ?? 'indisponivel';
      resposta = 'O agente não conseguiu responder agora. Tente de novo em instantes.';
    }
  } catch (e) {
    erro = 'indisponivel';
    resposta = (e as { name?: string }).name === 'AbortError'
      ? 'O agente demorou demais para responder. Tente de novo em instantes.'
      : 'Não foi possível falar com o agente agora. Tente de novo em instantes.';
    if ((e as { name?: string }).name !== 'AbortError') registrarErro('dúvidas: agente', e);
  } finally {
    clearTimeout(tempo);
  }

  const r = await banco.query(
    `update mod_duvidas set resposta = $2, erro = $3, respondido_em = now() where id = $1
     returning id, pergunta, resposta, erro, criado_em, respondido_em`, [id, resposta, erro]);
  // Registro só com o resultado, sem o texto da pergunta.
  await auditar(central(), u, u.empresa!.id, 'duvidas_perguntar', null, { resultado: erro ?? 'respondida' }).catch(() => undefined);
  return linha(r.rows[0]);
}
