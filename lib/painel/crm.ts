import 'server-only';
import { banco, ErroApi } from '@/lib/db';
import * as api from '@/lib/api/servico';
import { atorDe, podeArquivar, type Usuario } from '@/lib/sessao';

// Leitura e ações do CRM para as telas do painel. Toda escrita passa pela mesma camada da API
// (lib/api/servico.ts), com auditoria em nome da pessoa logada.

export type Etapa = 'aguardando' | 'em_atendimento' | 'pendente' | 'finalizado';
export const ETAPAS: Etapa[] = ['aguardando', 'em_atendimento', 'pendente', 'finalizado'];
const NOMES_PADRAO: Record<Etapa, string> = {
  aguardando: 'Aguardando equipe', em_atendimento: 'Em atendimento', pendente: 'Pendente interno', finalizado: 'Finalizado',
};

export type Topico = { id: string; nome: string; icone: string; ordem: number };
export type Cartao = {
  id: string; topico_id: string | null; etapa: Etapa; resumo: string; sombra: boolean;
  aberto_por: string | null; aberto_em: string; responsavel: string | null; assumido_em: string | null; finalizado_em: string | null;
  contato_id: string | null; nome: string | null; telefone: string | null; documento: string | null; notas: number; lead: boolean;
};
export type Quadro = {
  topicos: Topico[]; etapas: Record<Etapa, string>; cartoes: Cartao[]; finalizadosHoje: number; fuso: string; lidoEm: string;
};

export const fuso = () => process.env.PAINEL_FUSO || 'America/Sao_Paulo';

// CPF no meio do texto ou no campo documento: o papel planee vê só o final (regra 6).
const CPF_TEXTO = /\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g;
function mascararTexto(t: string) { return t.replace(CPF_TEXTO, (_m, _a, _b, _c, d: string) => '***.***.***-' + d); }
function mascararDoc(d: string | null) { return d ? '***.***.***-' + d.replace(/\D/g, '').slice(-2) : null; }

const SOMBRA = /^\s*\[SOMBRA\]\s*/;
// O pg devolve Date; a tela recebe texto ISO.
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function limparCartao(u: Usuario, r: Record<string, unknown>): Cartao {
  const resumo = String(r.resumo ?? '');
  const c = {
    ...(r as unknown as Cartao),
    sombra: SOMBRA.test(resumo),
    resumo: resumo.replace(SOMBRA, ''),
    notas: Number(r.notas) || 0,
    lead: Boolean(r.oportunidade_id),
    aberto_em: iso(r.aberto_em) as string,
    assumido_em: iso(r.assumido_em),
    finalizado_em: iso(r.finalizado_em),
  };
  if (u.papel === 'planee') { c.resumo = mascararTexto(c.resumo); c.documento = mascararDoc(c.documento); }
  return c;
}

async function nomesEtapas(): Promise<Record<Etapa, string>> {
  const r = await banco().query(`select valor from crm_config where chave = 'etapas_atendimento'`);
  const v = (r.rows[0]?.valor ?? {}) as Partial<Record<Etapa, string>>;
  return { ...NOMES_PADRAO, ...v };
}

const SELECT_CARTAO = `
  select a.id, a.topico_id, a.etapa, a.resumo, a.aberto_por, a.aberto_em, a.responsavel, a.assumido_em, a.finalizado_em,
         a.oportunidade_id, a.contato_id, c.nome, c.telefone, c.documento,
         (select count(*) from notas n where n.alvo_tipo = 'atendimentos' and n.alvo_id = a.id and not n.arquivado) as notas
    from atendimentos a left join contatos c on c.id = a.contato_id`;

export async function lerQuadro(u: Usuario): Promise<Quadro> {
  const f = fuso();
  const [tops, etapas, cards, fin] = await Promise.all([
    banco().query(`select id, nome, icone, ordem from crm_topicos where not arquivado order by ordem, nome`),
    nomesEtapas(),
    banco().query(
      `${SELECT_CARTAO}
        where not a.arquivado
          and (a.etapa <> 'finalizado' or a.finalizado_em >= (date_trunc('day', now() at time zone $1) at time zone $1))
        order by a.aberto_em desc limit 600`, [f]),
    banco().query(
      `select count(*)::int n from atendimentos where not arquivado and etapa = 'finalizado'
          and finalizado_em >= (date_trunc('day', now() at time zone $1) at time zone $1)`, [f]),
  ]);
  return {
    topicos: tops.rows as Topico[], etapas, fuso: f, lidoEm: new Date().toISOString(),
    cartoes: cards.rows.map((r) => limparCartao(u, r)), finalizadosHoje: fin.rows[0].n,
  };
}

export type Evento = { quando: string; texto: string; quem: string | null; tipo: 'nota' | 'acao' };
export type Detalhe = { cartao: Cartao; eventos: Evento[] };

export async function lerDetalhe(u: Usuario, id: string): Promise<Detalhe> {
  const [a, etapas] = await Promise.all([banco().query(`${SELECT_CARTAO} where a.id = $1`, [id]), nomesEtapas()]);
  if (!a.rowCount) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  const cartao = limparCartao(u, a.rows[0]);
  const [notas, aud] = await Promise.all([
    banco().query(`select texto, autor, criado_em from notas where alvo_tipo = 'atendimentos' and alvo_id = $1 and not arquivado order by criado_em`, [id]),
    banco().query(
      `select p.quando, p.acao, p.detalhe, coalesce(u.nome, k.nome) as quem
         from painel_auditoria p left join painel_usuarios u on u.id = p.usuario_id left join api_chaves k on k.id = p.chave_id
        where p.recurso = 'atendimentos' and p.alvo_id = $1 order by p.quando`, [id]),
  ]);
  const eventos: Evento[] = [
    { quando: cartao.aberto_em, texto: `Aberto${cartao.aberto_por ? ' por ' + cartao.aberto_por : ''}`, quem: null, tipo: 'acao' },
  ];
  for (const r of aud.rows) {
    if (r.acao === 'criar') continue;
    const d = (r.detalhe ?? {}) as Record<string, string>;
    let t = r.acao === 'arquivar' ? 'Arquivou' : 'Editou';
    if (d.etapa === 'em_atendimento' && d.responsavel) t = 'Assumiu';
    else if (d.etapa) t = `Moveu para ${etapas[d.etapa as Etapa] ?? d.etapa}`;
    else if (d.topico_id) t = 'Mudou o assunto';
    else if (d.responsavel) t = `Responsável: ${d.responsavel}`;
    eventos.push({ quando: new Date(r.quando).toISOString(), texto: t, quem: r.quem, tipo: 'acao' });
  }
  for (const n of notas.rows) {
    const texto = String(n.texto).replace(SOMBRA, '');
    eventos.push({ quando: new Date(n.criado_em).toISOString(), texto: u.papel === 'planee' ? mascararTexto(texto) : texto, quem: n.autor, tipo: 'nota' });
  }
  eventos.sort((x, y) => x.quando.localeCompare(y.quando));
  return { cartao, eventos };
}

// ---- Ações do quadro ----

async function etapaAtual(id: string): Promise<{ etapa: Etapa; responsavel: string | null }> {
  const r = await banco().query(`select etapa, responsavel from atendimentos where id = $1 and not arquivado`, [id]);
  if (!r.rowCount) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  return r.rows[0];
}

export async function assumir(u: Usuario, id: string) {
  // Atômico: trava a linha e confere "aguardando" na mesma transação (lib/api/servico.ts).
  await api.assumirAtendimento(atorDe(u), id, u.nome);
}

export async function mover(u: Usuario, id: string, etapa: Etapa) {
  if (!ETAPAS.includes(etapa)) throw new ErroApi(400, 'Etapa inválida.');
  const atual = await etapaAtual(id);
  if (atual.etapa === etapa) return;
  const dados: Record<string, string> = { etapa };
  // Quem tira do "aguardando" passa a ser o responsável, se ainda não houver um.
  if (etapa !== 'aguardando' && !atual.responsavel) dados.responsavel = u.nome;
  await api.atualizar(atorDe(u), 'atendimentos', id, dados);
  if (etapa !== 'aguardando') await banco().query(`update atendimentos set assumido_em = coalesce(assumido_em, now()) where id = $1`, [id]);
}

export async function mudarAssunto(u: Usuario, id: string, topico: string) {
  await api.atualizar(atorDe(u), 'atendimentos', id, { topico_id: topico });
}

export async function anotar(u: Usuario, id: string, texto: string) {
  const t = texto.trim();
  if (!t) throw new ErroApi(400, 'Escreva a nota antes de salvar.');
  if (t.length > 4000) throw new ErroApi(400, 'A nota passou de 4.000 caracteres.');
  await etapaAtual(id);
  await api.criar(atorDe(u), 'notas', { alvo_tipo: 'atendimentos', alvo_id: id, texto: t, autor: u.nome });
}

export async function arquivarAtendimento(u: Usuario, id: string) {
  if (!podeArquivar(u)) throw new ErroApi(403, 'Só gestor ou Planee arquiva atendimentos.');
  await api.arquivar(atorDe(u), 'atendimentos', id);
}

// ---- Comercial e contatos (leitura) ----

export async function lerComercial(u: Usuario) {
  const [et, ops] = await Promise.all([
    banco().query(`select id, nome, tipo, ordem from crm_etapas where not arquivado order by ordem, nome`),
    banco().query(
      `select o.id, o.etapa_id, o.interesse, o.valor, o.atualizado_em, c.nome, c.telefone
         from oportunidades o left join contatos c on c.id = o.contato_id
        where not o.arquivado order by o.atualizado_em desc limit 600`),
  ]);
  void u;
  return { etapas: et.rows as { id: string; nome: string; tipo: string }[], oportunidades: ops.rows.map((r) => ({ ...r, atualizado_em: new Date(r.atualizado_em).toISOString(), valor: r.valor === null ? null : Number(r.valor) })) };
}

export async function lerContatos(u: Usuario) {
  const r = await banco().query(
    `select c.id, c.nome, c.telefone, c.documento, c.criado_em,
            (select count(*) from atendimentos a where a.contato_id = c.id and not a.arquivado and a.etapa <> 'finalizado')::int as abertos,
            (select count(*) from atendimentos a where a.contato_id = c.id and not a.arquivado)::int as total,
            (select max(a.aberto_em) from atendimentos a where a.contato_id = c.id and not a.arquivado) as ultimo
       from contatos c where not c.arquivado
      order by coalesce((select max(a.aberto_em) from atendimentos a where a.contato_id = c.id), c.criado_em) desc limit 1000`);
  return r.rows.map((c) => ({
    id: c.id as string, nome: c.nome as string | null, telefone: c.telefone as string | null,
    documento: u.papel === 'planee' ? mascararDoc(c.documento) : (c.documento as string | null),
    abertos: c.abertos as number, total: c.total as number, ultimo: c.ultimo ? new Date(c.ultimo).toISOString() : null,
  }));
}

export async function lerAtendimentosDoContato(u: Usuario, contatoId: string) {
  const r = await banco().query(`${SELECT_CARTAO} where a.contato_id = $1 and not a.arquivado order by a.aberto_em desc limit 100`, [contatoId]);
  return r.rows.map((x) => limparCartao(u, x));
}
