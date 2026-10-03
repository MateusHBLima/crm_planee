import 'server-only';
import { bancoDaEmpresa, ErroApi } from '@/lib/db';
import * as api from '@/lib/api/servico';
import { atorDe, pode, podeArquivar, type Usuario } from '@/lib/sessao';
import { chaveTelefone, normalizarTelefone, SQL_MESMO_TELEFONE } from '@/lib/telefone';

// Banco de dados da empresa escolhida pela pessoa (decisão 26). Sem empresa, nada de CRM.
function db(u: Usuario) {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir o CRM.');
  if (!pode(u, 'crm.ver')) throw new ErroApi(403, 'Você não tem acesso ao CRM nesta empresa.');
  return bancoDaEmpresa(u.empresa);
}

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

// CPF no meio do texto ou no campo documento: o master (Planee) vê só o final (regra 6).
const CPF_TEXTO = /\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g;
export function mascararTexto(t: string) { return t.replace(CPF_TEXTO, (_m, _a, _b, _c, d: string) => '***.***.***-' + d); }
function mascararDoc(d: string | null) { return d ? '***.***.***-' + d.replace(/\D/g, '').slice(-2) : null; }

const SOMBRA = /^\s*\[SOMBRA\]\s*/;
// Cartões da Sara nova em modo sombra (pacientes reais da produção, a IA não respondeu): só a Planee (master) vê,
// e ninguém move nem finaliza (finalizar avisaria o n8n com o telefone real). Auditoria 01/10, S4.
const SQL_SEM_SOMBRA = `a.resumo !~ '^\\s*\\[SOMBRA\\]'`;
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
  if (u.master) { c.resumo = mascararTexto(c.resumo); c.documento = mascararDoc(c.documento); }
  return c;
}

async function nomesEtapas(u: Usuario): Promise<Record<Etapa, string>> {
  const r = await db(u).query(`select valor from crm_config where chave = 'etapas_atendimento'`);
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
    db(u).query(`select id, nome, icone, ordem from crm_topicos where not arquivado order by ordem, nome`),
    nomesEtapas(u),
    db(u).query(
      `${SELECT_CARTAO}
        where not a.arquivado and ($2::boolean or ${SQL_SEM_SOMBRA})
          and (a.etapa <> 'finalizado' or a.finalizado_em >= (date_trunc('day', now() at time zone $1) at time zone $1))
        order by a.aberto_em desc limit 600`, [f, u.master]),
    db(u).query(
      `select count(*)::int n from atendimentos a where not a.arquivado and a.etapa = 'finalizado' and ($2::boolean or ${SQL_SEM_SOMBRA})
          and a.finalizado_em >= (date_trunc('day', now() at time zone $1) at time zone $1)`, [f, u.master]),
  ]);
  return {
    topicos: tops.rows as Topico[], etapas, fuso: f, lidoEm: new Date().toISOString(),
    cartoes: cards.rows.map((r) => limparCartao(u, r)), finalizadosHoje: fin.rows[0].n,
  };
}

export type Evento = { quando: string; texto: string; quem: string | null; tipo: 'nota' | 'acao' };
export type Detalhe = { cartao: Cartao; eventos: Evento[] };

export async function lerDetalhe(u: Usuario, id: string): Promise<Detalhe> {
  const [a, etapas] = await Promise.all([db(u).query(`${SELECT_CARTAO} where a.id = $1`, [id]), nomesEtapas(u)]);
  if (!a.rowCount) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  const cartao = limparCartao(u, a.rows[0]);
  if (cartao.sombra && !u.master) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  const [notas, aud] = await Promise.all([
    db(u).query(`select texto, autor, criado_em from notas where alvo_tipo = 'atendimentos' and alvo_id = $1 and not arquivado order by criado_em`, [id]),
    db(u).query(
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
    eventos.push({ quando: new Date(n.criado_em).toISOString(), texto: u.master ? mascararTexto(texto) : texto, quem: n.autor, tipo: 'nota' });
  }
  eventos.sort((x, y) => x.quando.localeCompare(y.quando));
  return { cartao, eventos };
}

// ---- Ações do quadro ----

async function etapaAtual(u: Usuario, id: string): Promise<{ etapa: Etapa; responsavel: string | null; sombra: boolean }> {
  const r = await db(u).query(`select etapa, responsavel, resumo from atendimentos where id = $1 and not arquivado`, [id]);
  if (!r.rowCount) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  const sombra = SOMBRA.test(String(r.rows[0].resumo ?? ''));
  if (sombra && !u.master) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  return { etapa: r.rows[0].etapa, responsavel: r.rows[0].responsavel, sombra };
}

const ERRO_SOMBRA = 'Cartão sombra serve só para conferir o que a Sara nova teria feito: dá para anotar e arquivar, não para mover.';

export async function assumir(u: Usuario, id: string) {
  if ((await etapaAtual(u, id)).sombra) throw new ErroApi(409, ERRO_SOMBRA);
  // Atômico: trava a linha e confere "aguardando" na mesma transação (lib/api/servico.ts).
  await api.assumirAtendimento(atorDe(u), id, u.nome);
}

// "de" é a etapa que a tela mostrava. Se outra pessoa mudou o cartão nesse meio-tempo, não sobrescreve:
// avisa e a tela recarrega (auditoria 01/10, U3).
export async function mover(u: Usuario, id: string, etapa: Etapa, de?: Etapa) {
  if (!ETAPAS.includes(etapa)) throw new ErroApi(400, 'Etapa inválida.');
  const atual = await etapaAtual(u, id);
  if (atual.sombra) throw new ErroApi(409, ERRO_SOMBRA);
  if (de && ETAPAS.includes(de) && atual.etapa !== de) {
    const nomes = await nomesEtapas(u);
    throw new ErroApi(409, `Outra pessoa já mudou este atendimento para "${nomes[atual.etapa]}". O quadro foi atualizado.`);
  }
  if (atual.etapa === etapa) return;
  const dados: Record<string, string> = { etapa };
  // Quem tira do "aguardando" passa a ser o responsável, se ainda não houver um.
  if (etapa !== 'aguardando' && !atual.responsavel) dados.responsavel = u.nome;
  await api.atualizar(atorDe(u), 'atendimentos', id, dados);
  if (etapa !== 'aguardando') await db(u).query(`update atendimentos set assumido_em = coalesce(assumido_em, now()) where id = $1`, [id]);
  if (etapa === 'finalizado') await avisarFinalizado(u, id);
}

export async function mudarAssunto(u: Usuario, id: string, topico: string) {
  await api.atualizar(atorDe(u), 'atendimentos', id, { topico_id: topico });
}

export async function anotar(u: Usuario, id: string, texto: string) {
  const t = texto.trim();
  if (!t) throw new ErroApi(400, 'Escreva a nota antes de salvar.');
  if (t.length > 4000) throw new ErroApi(400, 'A nota passou de 4.000 caracteres.');
  await etapaAtual(u, id);
  await api.criar(atorDe(u), 'notas', { alvo_tipo: 'atendimentos', alvo_id: id, texto: t, autor: u.nome });
}

export async function arquivarAtendimento(u: Usuario, id: string) {
  if (!podeArquivar(u)) throw new ErroApi(403, 'Só gestor ou Planee arquiva atendimentos.');
  await api.arquivar(atorDe(u), 'atendimentos', id);
}

// ---- Comercial e contatos (leitura) ----

export async function lerComercial(u: Usuario) {
  const [et, ops] = await Promise.all([
    db(u).query(`select id, nome, tipo, ordem from crm_etapas where not arquivado order by ordem, nome`),
    db(u).query(
      `select o.id, o.etapa_id, o.contato_id, o.interesse, o.valor, o.atualizado_em, c.nome, c.telefone
         from oportunidades o left join contatos c on c.id = o.contato_id
        where not o.arquivado order by o.atualizado_em desc limit 600`),
  ]);
  void u;
  return { etapas: et.rows as { id: string; nome: string; tipo: string }[], oportunidades: ops.rows.map((r) => ({ ...r, atualizado_em: new Date(r.atualizado_em).toISOString(), valor: r.valor === null ? null : Number(r.valor) })) };
}

export async function lerContatos(u: Usuario) {
  const r = await db(u).query(
    `select c.id, c.nome, c.telefone, c.documento, c.criado_em,
            (select count(*) from atendimentos a where a.contato_id = c.id and not a.arquivado and a.etapa <> 'finalizado')::int as abertos,
            (select count(*) from atendimentos a where a.contato_id = c.id and not a.arquivado)::int as total,
            (select max(a.aberto_em) from atendimentos a where a.contato_id = c.id and not a.arquivado) as ultimo
       from contatos c where not c.arquivado
      order by coalesce((select max(a.aberto_em) from atendimentos a where a.contato_id = c.id), c.criado_em) desc limit 1000`);
  return r.rows.map((c) => ({
    id: c.id as string, nome: c.nome as string | null, telefone: c.telefone as string | null,
    documento: u.master ? mascararDoc(c.documento) : (c.documento as string | null),
    abertos: c.abertos as number, total: c.total as number, ultimo: c.ultimo ? new Date(c.ultimo).toISOString() : null,
  }));
}

export async function lerAtendimentosDoContato(u: Usuario, contatoId: string) {
  const r = await db(u).query(`${SELECT_CARTAO} where a.contato_id = $1 and not a.arquivado order by a.aberto_em desc limit 100`, [contatoId]);
  return r.rows.map((x) => limparCartao(u, x)).filter((c) => u.master || !c.sombra);
}

// ---- Criação e edição pelo painel (CRM completo) ----

// Mesmo contato com e sem o 9: compara DDD + últimos 8 dígitos (regra tel_chave).
async function contatoPorTelefone(u: Usuario, tel: string): Promise<{ id: string; nome: string | null } | null> {
  const r = await db(u).query(
    `select id, nome from contatos where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em limit 1`,
    chaveTelefone(tel),
  );
  return r.rowCount ? r.rows[0] : null;
}

function textoObrigatorio(v: unknown, campo: string, max: number): string {
  const s = String(v ?? '').trim();
  if (!s) throw new ErroApi(400, `Preencha ${campo}.`);
  if (s.length > max) throw new ErroApi(400, `${campo[0].toUpperCase() + campo.slice(1)} passou de ${max} caracteres.`);
  return s;
}

function textoOpcional(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

// Acha o contato pelo telefone (com ou sem o 9) ou cria um novo. Nome novo só preenche contato sem nome.
async function garantirContato(u: Usuario, telefone: unknown, nome: unknown): Promise<string> {
  const tel = normalizarTelefone(telefone);
  const n = textoOpcional(nome, 120);
  const achado = await contatoPorTelefone(u, tel);
  if (achado) {
    if (n && !achado.nome) await api.atualizar(atorDe(u), 'contatos', achado.id, { nome: n });
    return achado.id;
  }
  const novo = await api.criar(atorDe(u), 'contatos', { telefone: tel, nome: n });
  return String(novo.id);
}

export async function novoAtendimento(u: Usuario, dados: { telefone: unknown; nome: unknown; topico_id: unknown; resumo: unknown }) {
  const resumo = textoObrigatorio(dados.resumo, 'o resumo', 2000);
  const topico = String(dados.topico_id ?? '');
  const contato = await garantirContato(u, dados.telefone, dados.nome);
  const a = await api.criar(atorDe(u), 'atendimentos', { contato_id: contato, topico_id: topico || null, resumo, aberto_por: u.nome });
  return String(a.id);
}

export type Ficha = { id: string; nome: string | null; telefone: string | null; documento: string | null; tipo_documento: string | null; empresa: string | null };

export async function salvarContato(u: Usuario, id: string | null, dados: { nome: unknown; telefone: unknown; documento: unknown }) {
  const nome = textoOpcional(dados.nome, 120);
  const tel = normalizarTelefone(dados.telefone);
  const docDig = String(dados.documento ?? '').replace(/\D/g, '');
  if (docDig && docDig.length !== 11 && docDig.length !== 14) throw new ErroApi(400, 'Documento: CPF com 11 dígitos ou CNPJ com 14.');
  const campos = { nome, telefone: tel, documento: docDig || null, tipo_documento: docDig ? (docDig.length === 11 ? 'cpf' : 'cnpj') : null };
  if (u.master && id) delete (campos as Record<string, unknown>).documento, delete (campos as Record<string, unknown>).tipo_documento; // master vê o CPF mascarado: não sobrescreve
  const outro = await contatoPorTelefone(u, tel);
  if (outro && outro.id !== id) throw new ErroApi(409, `Esse telefone já é do contato ${outro.nome || 'sem nome'}.`);
  if (id) { await api.atualizar(atorDe(u), 'contatos', id, campos); return id; }
  return String((await api.criar(atorDe(u), 'contatos', campos)).id);
}

export async function notasDoContato(u: Usuario, contatoId: string) {
  const r = await db(u).query(
    `select id, texto, autor, criado_em from notas where alvo_tipo = 'contatos' and alvo_id = $1 and not arquivado order by criado_em desc limit 100`,
    [contatoId],
  );
  return r.rows.map((n) => ({ id: n.id as string, texto: u.master ? mascararTexto(String(n.texto)) : String(n.texto), autor: n.autor as string | null, criado_em: iso(n.criado_em) as string }));
}

export async function anotarContato(u: Usuario, contatoId: string, texto: string) {
  const t = textoObrigatorio(texto, 'a nota', 4000);
  await api.criar(atorDe(u), 'notas', { alvo_tipo: 'contatos', alvo_id: contatoId, texto: t, autor: u.nome });
}

// Funil comercial
// "1.234,56" e "800,00" (jeito brasileiro) ou "800.5" → número. Vazio → sem valor.
function lerValor(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(/^R\$\s*/i, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  if (!Number.isFinite(n) || n < 0) throw new ErroApi(400, 'Valor inválido. Ex.: 800,00');
  return n;
}
export async function novaOportunidade(u: Usuario, dados: { telefone: unknown; nome: unknown; interesse: unknown; valor: unknown; etapa_id: unknown }) {
  const contato = await garantirContato(u, dados.telefone, dados.nome);
  const valor = lerValor(dados.valor);
  const etapa = String(dados.etapa_id ?? '') || (await db(u).query(`select id from crm_etapas where not arquivado and tipo = 'aberta' order by ordem limit 1`)).rows[0]?.id;
  if (!etapa) throw new ErroApi(400, 'Crie uma etapa do funil antes.');
  await api.criar(atorDe(u), 'oportunidades', { contato_id: contato, interesse: textoOpcional(dados.interesse, 300), valor, etapa_id: etapa });
}

export async function editarOportunidade(u: Usuario, id: string, dados: { interesse?: unknown; valor?: unknown; etapa_id?: unknown }) {
  const campos: Record<string, unknown> = {};
  if (dados.etapa_id !== undefined) campos.etapa_id = String(dados.etapa_id);
  if (dados.interesse !== undefined) campos.interesse = textoOpcional(dados.interesse, 300);
  if (dados.valor !== undefined) {
    campos.valor = lerValor(dados.valor);
  }
  await api.atualizar(atorDe(u), 'oportunidades', id, campos);
}

export async function arquivarOportunidade(u: Usuario, id: string) {
  if (!podeArquivar(u)) throw new ErroApi(403, 'Você não tem permissão para arquivar.');
  await api.arquivar(atorDe(u), 'oportunidades', id);
}

// ---- Configuração do CRM (quem tem crm.config) ----

export type ConfigCrm = {
  etapasAtendimento: Record<Etapa, string>;
  topicos: { id: string; nome: string; icone: string; ordem: number; palavras: string | null }[];
  funil: { id: string; nome: string; tipo: string; ordem: number; gatilho: string | null }[];
};

export async function lerConfigCrm(u: Usuario): Promise<ConfigCrm> {
  const [et, tp, fn] = await Promise.all([
    nomesEtapas(u),
    db(u).query(`select id, nome, icone, ordem, palavras from crm_topicos where not arquivado order by ordem, nome`),
    db(u).query(`select id, nome, tipo, ordem, gatilho from crm_etapas where not arquivado order by ordem, nome`),
  ]);
  return { etapasAtendimento: et, topicos: tp.rows, funil: fn.rows };
}

const idDe = (nome: string) => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';

export async function salvarTopico(u: Usuario, id: string | null, dados: { nome: unknown; icone: unknown; ordem: unknown; palavras: unknown }) {
  const campos = {
    nome: textoObrigatorio(dados.nome, 'o nome do assunto', 60),
    icone: String(dados.icone || 'outros'),
    ordem: Number(dados.ordem) || 0,
    palavras: textoOpcional(dados.palavras, 1000),
  };
  if (id) return api.atualizar(atorDe(u), 'topicos', id, campos);
  return api.criar(atorDe(u), 'topicos', { id: idDe(campos.nome), ...campos });
}

export async function salvarEtapaFunil(u: Usuario, id: string | null, dados: { nome: unknown; tipo: unknown; ordem: unknown; gatilho: unknown }) {
  const tipo = String(dados.tipo || 'aberta');
  if (!['aberta', 'ganho', 'perdido'].includes(tipo)) throw new ErroApi(400, 'Tipo inválido.');
  const campos = {
    nome: textoObrigatorio(dados.nome, 'o nome da etapa', 60), tipo,
    ordem: Number(dados.ordem) || 0, gatilho: textoOpcional(dados.gatilho, 120) ?? 'Manual (equipe)',
  };
  if (id) return api.atualizar(atorDe(u), 'etapas', id, campos);
  return api.criar(atorDe(u), 'etapas', { id: idDe(campos.nome), ...campos });
}

export async function arquivarItemConfig(u: Usuario, recurso: 'topicos' | 'etapas', id: string) {
  if (recurso === 'topicos') {
    const abertos = await db(u).query(`select count(*)::int n from atendimentos where topico_id = $1 and not arquivado and etapa <> 'finalizado'`, [id]);
    if (abertos.rows[0].n) throw new ErroApi(409, `Esse assunto ainda tem ${abertos.rows[0].n} atendimento(s) aberto(s). Mude o assunto deles antes.`);
  }
  if (recurso === 'etapas') {
    const ops = await db(u).query(`select count(*)::int n from oportunidades where etapa_id = $1 and not arquivado`, [id]);
    if (ops.rows[0].n) throw new ErroApi(409, `Essa etapa ainda tem ${ops.rows[0].n} oportunidade(s). Mova antes de arquivar.`);
  }
  await api.arquivar(atorDe(u), recurso, id);
}

export async function salvarNomesEtapas(u: Usuario, nomes: Record<string, unknown>) {
  const valor: Partial<Record<Etapa, string>> = {};
  for (const e of ETAPAS) valor[e] = textoObrigatorio(nomes[e], `o nome de "${NOMES_PADRAO[e]}"`, 40);
  await api.definirConfig(atorDe(u), 'etapas_atendimento', valor);
}

// Avisa o n8n quando a equipe finaliza um atendimento, para a IA poder retomar a conversa (fase 2, 2.4).
// Só se o endereço estiver configurado; nunca atrasa nem derruba a tela.
export async function avisarFinalizado(u: Usuario, atendimentoId: string) {
  const url = process.env.N8N_WEBHOOK_PAINEL_RETOMAR;
  if (!url) return;
  try {
    const r = await db(u).query(`select c.telefone from atendimentos a left join contatos c on c.id = a.contato_id where a.id = $1`, [atendimentoId]);
    const telefone = r.rows[0]?.telefone;
    if (!telefone) return;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000);
    await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-painel-segredo': process.env.N8N_WEBHOOK_SEGREDO || '' },
      body: JSON.stringify({ evento: 'atendimento_finalizado', atendimento_id: atendimentoId, telefone, empresa: u.empresa?.id ?? null, por: u.nome }),
    }).catch(() => undefined).finally(() => clearTimeout(t));
  } catch { /* o aviso é extra: falha aqui não muda nada na tela */ }
}
