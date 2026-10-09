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
  aberto_por: string | null; aberto_em: string; atualizado_em: string; responsavel: string | null; assumido_em: string | null; finalizado_em: string | null;
  contato_id: string | null; nome: string | null; telefone: string | null; documento: string | null; notas: number; lead: boolean;
  alerta: boolean; // aberto por alerta (ex.: comprovante suspeito): vermelho desde que abre
};
// Prazos do quadro, em minutos: depois de "amarelo" o cartão fica amarelo, depois de "vermelho", vermelho.
// Aguardando conta desde que abriu; pendente interno, desde a última mudança (atualizado_em).
export type Prazo = { amarelo: number; vermelho: number };
export type Prazos = { aguardando: Prazo; pendente: Prazo };
export const PRAZOS_PADRAO: Prazos = { aguardando: { amarelo: 15, vermelho: 30 }, pendente: { amarelo: 24 * 60, vermelho: 48 * 60 } };

export type Quadro = {
  topicos: Topico[]; etapas: Record<Etapa, string>; cartoes: Cartao[]; finalizadosHoje: number; fuso: string; lidoEm: string;
  prazos: Prazos;
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
    alerta: r.alerta === true,
    aberto_em: iso(r.aberto_em) as string,
    atualizado_em: (iso(r.atualizado_em) ?? iso(r.aberto_em)) as string,
    assumido_em: iso(r.assumido_em),
    finalizado_em: iso(r.finalizado_em),
  };
  if (u.master) { c.resumo = mascararTexto(c.resumo); c.documento = mascararDoc(c.documento); }
  return c;
}

// Valor salvo em Configurações (crm_config "prazos_atendimento"); o que faltar ou vier errado fica no padrão.
function limparPrazos(v: unknown): Prazos {
  const r: Prazos = JSON.parse(JSON.stringify(PRAZOS_PADRAO));
  const x = (v ?? {}) as Record<string, Record<string, unknown>>;
  for (const e of ['aguardando', 'pendente'] as const) {
    const a = Number(x[e]?.amarelo), b = Number(x[e]?.vermelho);
    if (Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b > a && b <= 30 * 24 * 60) r[e] = { amarelo: a, vermelho: b };
  }
  return r;
}

async function lerPrazos(u: Usuario): Promise<Prazos> {
  const r = await db(u).query(`select valor from crm_config where chave = 'prazos_atendimento'`);
  return limparPrazos(r.rows[0]?.valor);
}

async function nomesEtapas(u: Usuario): Promise<Record<Etapa, string>> {
  const r = await db(u).query(`select valor from crm_config where chave = 'etapas_atendimento'`);
  const v = (r.rows[0]?.valor ?? {}) as Partial<Record<Etapa, string>>;
  return { ...NOMES_PADRAO, ...v };
}

const SELECT_CARTAO = `
  select a.id, a.topico_id, a.etapa, a.resumo, a.aberto_por, a.aberto_em, a.atualizado_em, a.responsavel, a.assumido_em, a.finalizado_em,
         a.oportunidade_id, a.contato_id, c.nome, c.telefone, c.documento,
         coalesce((to_jsonb(a) ->> 'alerta')::boolean, false) as alerta,
         (select count(*) from notas n where n.alvo_tipo = 'atendimentos' and n.alvo_id = a.id and not n.arquivado) as notas
    from atendimentos a left join contatos c on c.id = a.contato_id`;

// No quadro, o resumo vai cortado (o cartão mostra poucas linhas; o detalhe traz o texto inteiro). O banco fica em
// outra região, e o resumo inteiro de 60 cartões dobrava o tamanho da resposta (09/10).
export const RESUMO_NO_QUADRO = 600;
const SELECT_CARTAO_QUADRO = SELECT_CARTAO.replace('a.etapa, a.resumo,', `a.etapa, left(a.resumo, ${RESUMO_NO_QUADRO}) as resumo,`);

export async function lerQuadro(u: Usuario): Promise<Quadro> {
  const f = fuso();
  // Uma consulta só (uma ida ao banco, uma conexão): assuntos, nomes das etapas, prazos, cartões e a contagem de
  // finalizados de hoje. O banco fica em outra região; cinco consultas em paralelo abriam cinco conexões.
  // Abertos primeiro e do mais antigo para o mais novo: com muito acúmulo, o limite corta os finalizados de hoje
  // e os abertos mais novos, nunca os que esperam há mais tempo.
  const r = await db(u).query(
    `with hoje as (select (date_trunc('day', now() at time zone $1) at time zone $1) as ini),
     cartoes as (
       ${SELECT_CARTAO_QUADRO}
        where not a.arquivado and ($2::boolean or ${SQL_SEM_SOMBRA})
          and (a.etapa <> 'finalizado' or a.finalizado_em >= (select ini from hoje))
        order by (a.etapa = 'finalizado'), a.aberto_em limit 1000)
     select
       (select coalesce(json_agg(t order by t.ordem, t.nome), '[]'::json)
          from (select id, nome, icone, ordem from crm_topicos where not arquivado) t) as topicos,
       (select valor from crm_config where chave = 'etapas_atendimento') as etapas,
       (select valor from crm_config where chave = 'prazos_atendimento') as prazos,
       (select count(*)::int from atendimentos a where not a.arquivado and a.etapa = 'finalizado'
           and ($2::boolean or ${SQL_SEM_SOMBRA}) and a.finalizado_em >= (select ini from hoje)) as fin,
       (select coalesce(json_agg(c order by (c.etapa = 'finalizado'), c.aberto_em), '[]'::json) from cartoes c) as cartoes`, [f, u.master]);
  const x = r.rows[0];
  return {
    topicos: x.topicos as Topico[], etapas: { ...NOMES_PADRAO, ...((x.etapas ?? {}) as Partial<Record<Etapa, string>>) },
    fuso: f, lidoEm: new Date().toISOString(), prazos: limparPrazos(x.prazos),
    cartoes: (x.cartoes as Record<string, unknown>[]).map((c) => limparCartao(u, c)), finalizadosHoje: x.fin,
  };
}

export type Evento = { quando: string; texto: string; quem: string | null; tipo: 'nota' | 'acao' };
export type Detalhe = { cartao: Cartao; eventos: Evento[] };

export async function lerDetalhe(u: Usuario, id: string): Promise<Detalhe> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  // Uma ida só ao banco: o cartão, os nomes das etapas, as notas e o que aconteceu (auditoria).
  const r = await db(u).query(
    `select (select row_to_json(c) from (${SELECT_CARTAO} where a.id = $1::uuid) c) as cartao,
            (select valor from crm_config where chave = 'etapas_atendimento') as etapas,
            (select coalesce(json_agg(n order by n.criado_em), '[]'::json)
               from (select texto, autor, criado_em from notas where alvo_tipo = 'atendimentos' and alvo_id = $1::uuid and not arquivado) n) as notas,
            (select coalesce(json_agg(x order by x.quando), '[]'::json)
               from (select p.quando, p.acao, p.detalhe, coalesce(u.nome, k.nome) as quem
                       from painel_auditoria p left join painel_usuarios u on u.id = p.usuario_id left join api_chaves k on k.id = p.chave_id
                      where p.recurso = 'atendimentos' and p.alvo_id::text = $1::text) x) as aud`, [id]);
  const linha = r.rows[0];
  if (!linha?.cartao) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  const etapas = { ...NOMES_PADRAO, ...((linha.etapas ?? {}) as Partial<Record<Etapa, string>>) };
  const cartao = limparCartao(u, linha.cartao);
  if (cartao.sombra && !u.master) throw new ErroApi(404, 'Atendimento não encontrado. Ele pode ter sido arquivado.');
  const notas = { rows: linha.notas as { texto: string; autor: string; criado_em: string }[] };
  const aud = { rows: linha.aud as { quando: string; acao: string; detalhe: unknown; quem: string | null }[] };
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

const ERRO_SOMBRA = 'Cartão sombra serve só para conferir o que a Sara nova teria feito: dá para anotar e arquivar, não para mover.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAO_ACHADO = 'Atendimento não encontrado. Ele pode ter sido arquivado.';
const SQL_E_SOMBRA = `(coalesce(resumo, '') ~ '^\\s*\\[SOMBRA\\]')`;

// Ações do quadro em uma ida só ao banco (09/10). O banco da clínica fica em outra região (~0,2 s por ida); antes,
// cada clique fazia 5 a 8 idas em fila (conferir, begin, update, auditoria, commit...). Agora cada ação é um único
// comando com CTEs: trava a linha, confere, muda e grava a auditoria juntos (um comando só já é atômico).
// As regras são as mesmas de antes (e as da API, lib/api/servico.ts): sombra não se move, "aguardando" só se
// assume uma vez, quem tira do aguardando vira responsável, finalizar avisa o n8n.
function exigirEditar(u: Usuario) {
  if (!pode(u, 'crm.editar')) throw new ErroApi(403, 'Você não tem permissão para isso nesta empresa.');
  return db(u);
}

function traduzir(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23503') throw new ErroApi(400, 'Referência inválida: o registro ligado não existe.');
  if (code === '22P02') throw new ErroApi(400, 'Formato de valor inválido.');
  if (code === '23514') throw new ErroApi(400, 'Valor fora do permitido.');
  throw e;
}

export async function assumir(u: Usuario, id: string) {
  const banco = exigirEditar(u);
  if (!UUID.test(String(id))) throw new ErroApi(404, NAO_ACHADO);
  const r = await banco.query(
    `with alvo as (select id, etapa, responsavel, ${SQL_E_SOMBRA} as sombra from atendimentos where id = $1 and not arquivado for update),
     upd as (update atendimentos a set etapa = 'em_atendimento', responsavel = $2, assumido_em = coalesce(a.assumido_em, now()),
                    finalizado_em = null, atualizado_em = now()
               from alvo where a.id = alvo.id and alvo.etapa = 'aguardando' and not alvo.sombra returning a.id),
     aud as (insert into painel_auditoria (usuario_id, acao, recurso, alvo_id, detalhe)
             select $3::uuid, 'atualizar', 'atendimentos', $1::text, jsonb_build_object('etapa', 'em_atendimento', 'responsavel', $2::text) from upd)
     select etapa, responsavel, sombra, exists (select 1 from upd) as feito from alvo`, [id, u.nome, u.id]).catch(traduzir);
  const x = r.rows[0];
  if (!x || (x.sombra && !u.master)) throw new ErroApi(404, NAO_ACHADO);
  if (x.sombra) throw new ErroApi(409, ERRO_SOMBRA);
  if (!x.feito) throw new ErroApi(409, x.responsavel ? `${x.responsavel} já assumiu este atendimento.` : 'Este atendimento já saiu de "aguardando".');
}

// "de" é a etapa que a tela mostrava. Se outra pessoa mudou o cartão nesse meio-tempo, não sobrescreve:
// avisa e a tela recarrega (auditoria 01/10, U3).
export async function mover(u: Usuario, id: string, etapa: Etapa, de?: Etapa) {
  if (!ETAPAS.includes(etapa)) throw new ErroApi(400, 'Etapa inválida.');
  const banco = exigirEditar(u);
  if (!UUID.test(String(id))) throw new ErroApi(404, NAO_ACHADO);
  const deOk = de && ETAPAS.includes(de) ? de : null;
  const r = await banco.query(
    `with alvo as (select id, etapa, responsavel, contato_id, ${SQL_E_SOMBRA} as sombra from atendimentos where id = $1 and not arquivado for update),
     upd as (update atendimentos a set etapa = $2::text,
                    responsavel = case when $2::text <> 'aguardando' and a.responsavel is null then $3::text else a.responsavel end,
                    assumido_em = case when $2::text <> 'aguardando' then coalesce(a.assumido_em, now()) else a.assumido_em end,
                    finalizado_em = case when $2::text = 'finalizado' then now() else null end,
                    atualizado_em = now()
               from alvo where a.id = alvo.id and not alvo.sombra and ($4::text is null or alvo.etapa = $4::text) and alvo.etapa <> $2::text
             returning a.id),
     aud as (insert into painel_auditoria (usuario_id, acao, recurso, alvo_id, detalhe)
             select $5::uuid, 'atualizar', 'atendimentos', $1::text,
                    jsonb_build_object('etapa', $2::text)
                      || case when $2::text <> 'aguardando' and alvo.responsavel is null then jsonb_build_object('responsavel', $3::text) else '{}'::jsonb end
               from upd, alvo)
     select alvo.etapa, alvo.sombra, exists (select 1 from upd) as feito,
            (select c.telefone from contatos c where c.id = alvo.contato_id) as telefone
       from alvo`, [id, etapa, u.nome, deOk, u.id]).catch(traduzir);
  const x = r.rows[0];
  if (!x || (x.sombra && !u.master)) throw new ErroApi(404, NAO_ACHADO);
  if (x.sombra) throw new ErroApi(409, ERRO_SOMBRA);
  if (!x.feito) {
    // A tela mostrava outra etapa: alguém mexeu antes (mesmo que tenha sido para a etapa pedida). Senão, já estava lá.
    if (!deOk || x.etapa === deOk) return;
    const nomes = await nomesEtapas(u);
    throw new ErroApi(409, `Outra pessoa já mudou este atendimento para "${nomes[x.etapa as Etapa] ?? x.etapa}". O quadro foi atualizado.`);
  }
  // O aviso ao n8n não segura a tela: a Sara retoma em segundo plano.
  if (etapa === 'finalizado') void avisarFinalizado(u, id, x.telefone ?? null);
}

export async function mudarAssunto(u: Usuario, id: string, topico: string) {
  const banco = exigirEditar(u);
  if (!UUID.test(String(id))) throw new ErroApi(404, `atendimentos/${id} não encontrado.`);
  const t = String(topico ?? '');
  if (!t || t.length > 60) throw new ErroApi(400, 'Assunto inválido.');
  const r = await banco.query(
    `with upd as (update atendimentos set topico_id = $2, atualizado_em = now() where id = $1 returning id),
     aud as (insert into painel_auditoria (usuario_id, acao, recurso, alvo_id, detalhe)
             select $3::uuid, 'atualizar', 'atendimentos', $1::text, jsonb_build_object('topico_id', $2::text) from upd)
     select exists (select 1 from upd) as feito`, [id, t, u.id]).catch(traduzir);
  if (!r.rows[0]?.feito) throw new ErroApi(404, `atendimentos/${id} não encontrado.`);
}

export async function anotar(u: Usuario, id: string, texto: string) {
  const t = texto.trim();
  if (!t) throw new ErroApi(400, 'Escreva a nota antes de salvar.');
  if (t.length > 4000) throw new ErroApi(400, 'A nota passou de 4.000 caracteres.');
  const banco = exigirEditar(u);
  if (!UUID.test(String(id))) throw new ErroApi(404, NAO_ACHADO);
  const r = await banco.query(
    `with alvo as (select id, ${SQL_E_SOMBRA} as sombra from atendimentos where id = $1 and not arquivado),
     ins as (insert into notas (alvo_tipo, alvo_id, texto, autor)
             select 'atendimentos', alvo.id, $2, $3 from alvo where not alvo.sombra or $4::boolean returning id),
     aud as (insert into painel_auditoria (usuario_id, acao, recurso, alvo_id, detalhe)
             select $5::uuid, 'criar', 'notas', ins.id::text,
                    jsonb_build_object('alvo_tipo', 'atendimentos', 'alvo_id', $1::text, 'texto', $2::text, 'autor', $3::text) from ins)
     select alvo.sombra, exists (select 1 from ins) as feito from alvo`, [id, t, u.nome, u.master, u.id]).catch(traduzir);
  if (!r.rows[0]?.feito) throw new ErroApi(404, NAO_ACHADO);
}

export async function arquivarAtendimento(u: Usuario, id: string) {
  if (!podeArquivar(u)) throw new ErroApi(403, 'Só gestor ou Planee arquiva atendimentos.');
  const banco = exigirEditar(u);
  if (!UUID.test(String(id))) throw new ErroApi(404, `atendimentos/${id} não encontrado.`);
  const r = await banco.query(
    `with upd as (update atendimentos set arquivado = true, atualizado_em = now() where id = $1 returning id),
     aud as (insert into painel_auditoria (usuario_id, acao, recurso, alvo_id, detalhe)
             select $2::uuid, 'arquivar', 'atendimentos', $1::text, null from upd)
     select exists (select 1 from upd) as feito`, [id, u.id]).catch(traduzir);
  if (!r.rows[0]?.feito) throw new ErroApi(404, `atendimentos/${id} não encontrado.`);
}

// ---- Comercial e contatos (leitura) ----

export async function lerComercial(u: Usuario) {
  // Uma ida só ao banco: etapas do funil e oportunidades.
  const r = await db(u).query(
    `select (select coalesce(json_agg(e order by e.ordem, e.nome), '[]'::json)
               from (select id, nome, tipo, ordem from crm_etapas where not arquivado) e) as etapas,
            (select coalesce(json_agg(o order by o.atualizado_em desc), '[]'::json)
               from (select o.id, o.etapa_id, o.contato_id, o.interesse, o.valor, o.atualizado_em, c.nome, c.telefone
                       from oportunidades o left join contatos c on c.id = o.contato_id
                      where not o.arquivado order by o.atualizado_em desc limit 600) o) as ops`);
  const x = r.rows[0];
  return {
    etapas: x.etapas as { id: string; nome: string; tipo: string }[],
    oportunidades: (x.ops as Record<string, unknown>[]).map((o) => ({
      id: String(o.id), etapa_id: String(o.etapa_id), contato_id: (o.contato_id as string) ?? null, interesse: (o.interesse as string) ?? null,
      nome: (o.nome as string) ?? null, telefone: (o.telefone as string) ?? null,
      atualizado_em: new Date(o.atualizado_em as string).toISOString(), valor: o.valor === null ? null : Number(o.valor),
    })),
  };
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
  prazos: Prazos;
  topicos: { id: string; nome: string; icone: string; ordem: number; palavras: string | null }[];
  funil: { id: string; nome: string; tipo: string; ordem: number; gatilho: string | null }[];
};

export async function lerConfigCrm(u: Usuario): Promise<ConfigCrm> {
  const [et, tp, fn, prazos] = await Promise.all([
    nomesEtapas(u),
    db(u).query(`select id, nome, icone, ordem, palavras from crm_topicos where not arquivado order by ordem, nome`),
    db(u).query(`select id, nome, tipo, ordem, gatilho from crm_etapas where not arquivado order by ordem, nome`),
    lerPrazos(u),
  ]);
  return { etapasAtendimento: et, prazos, topicos: tp.rows, funil: fn.rows };
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

// Prazos do quadro (Configurações). Chega em minutos; amarelo antes do vermelho, até 30 dias.
export async function salvarPrazos(u: Usuario, dados: Record<string, Record<string, unknown>>) {
  const valor = {} as Prazos;
  for (const [e, nome] of [['aguardando', 'Aguardando'], ['pendente', 'Pendente interno']] as const) {
    const a = Number(dados?.[e]?.amarelo), b = Number(dados?.[e]?.vermelho);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 30 * 24 * 60) throw new ErroApi(400, `${nome}: use números inteiros, de 1 minuto a 30 dias.`);
    if (b <= a) throw new ErroApi(400, `${nome}: o vermelho precisa vir depois do amarelo.`);
    valor[e] = { amarelo: a, vermelho: b };
  }
  await api.definirConfig(atorDe(u), 'prazos_atendimento', valor);
}

// Avisa o n8n quando a equipe finaliza um atendimento, para a IA poder retomar a conversa (fase 2, 2.4).
// Só se o endereço estiver configurado; nunca atrasa nem derruba a tela.
export async function avisarFinalizado(u: Usuario, atendimentoId: string, telefoneConhecido?: string | null) {
  const url = process.env.N8N_WEBHOOK_PAINEL_RETOMAR;
  if (!url) return;
  try {
    let telefone = telefoneConhecido;
    if (telefone === undefined) {
      const r = await db(u).query(`select c.telefone from atendimentos a left join contatos c on c.id = a.contato_id where a.id = $1`, [atendimentoId]);
      telefone = r.rows[0]?.telefone;
    }
    if (!telefone) return;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000);
    await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-painel-segredo': process.env.N8N_WEBHOOK_SEGREDO || '' },
      body: JSON.stringify({ evento: 'atendimento_finalizado', atendimento_id: atendimentoId, telefone, empresa: u.empresa?.id ?? null, por: u.nome }),
    }).catch(() => undefined).finally(() => clearTimeout(t));
  } catch { /* o aviso é extra: falha aqui não muda nada na tela */ }
}
