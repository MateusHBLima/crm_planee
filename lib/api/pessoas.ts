import 'server-only';
import type { PoolClient } from 'pg';
import { transacao, ErroApi } from '@/lib/db';
import { chaveTelefone, normalizarTelefone } from '@/lib/telefone';
import { cpfValido, PAPEIS } from '@/lib/pessoas';
import { bancoDe, type Chave } from './auth';
import { auditar, exigirEscopo } from './servico';

// Carga das pessoas de cada número (migração 024, 12/10): POST /api/v1/pessoas/lote. Vem do "Quem é quem" da IA
// (número ↔ paciente da Feegow, com papel). Contrato em claude/PARA_CHAT_SARA_cruzamento_12-10.md:
// • uma pessoa = um contato; o paciente do sistema aponta para ele em agenda_pacientes (migração 018);
// • proprio: é o dono do número (contatos.telefone); nome da Feegow, a não ser que o contato tenha outro CPF;
// • dependente/familiar ligados ao contato que é dono DESTE número (o espelho juntou o filho na mãe): ganham contato
//   próprio, sem telefone, e levam junto os agendamentos do sistema que são deles (e os comprovantes desses);
// • mesmo_numero/equipe_fornecedor: como dependente, mas o dono do número com o mesmo nome continua sendo ele;
// • o vínculo fica em contato_telefones; remover: true arquiva o vínculo;
// • CPF só se o contato não tem; nunca troca; nunca volta na resposta.
// Cada item roda num savepoint: erro num item não derruba os outros. Os "proprio" vão primeiro.

const MAX = 500;
const SISTEMA = /^[a-z0-9_]{1,30}$/;
type Item = Record<string, unknown>;
type Contato = { id: string; nome: string | null; telefone: string | null; documento: string | null };
export type ResultadoItem = {
  indice: number; ok: boolean; contato_id?: string; criado?: boolean; separado?: boolean; servicos_movidos?: number;
  removido?: boolean; aviso?: string; papel_gravado?: string; contato_cpf?: string; erro?: string;
};

class ErroItem extends Error {}
const normNome = (s: string | null | undefined) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const mesmoNumero = (a: string | null, b: string) => !!a && digitos(a).slice(2, 4) === b.slice(2, 4) && digitos(a).slice(-8) === b.slice(-8);

async function contato(c: PoolClient, id: string): Promise<Contato | null> {
  const r = await c.query(`select id, nome, telefone, documento from contatos where id = $1 and not arquivado`, [id]);
  return r.rows[0] ? { id: String(r.rows[0].id), nome: r.rows[0].nome, telefone: r.rows[0].telefone, documento: r.rows[0].documento } : null;
}

async function novoContato(c: PoolClient, nome: string | null, tel: string | null): Promise<Contato> {
  const r = await c.query(`insert into contatos (nome, telefone) values ($1, $2) returning id`, [nome, tel]);
  return { id: String(r.rows[0].id), nome, telefone: tel, documento: null };
}

async function umItem(c: PoolClient, it: Item, origem: string | null, indice: number): Promise<ResultadoItem> {
  if (!PAPEIS.includes(String(it.papel) as (typeof PAPEIS)[number])) throw new ErroItem('papel_invalido');
  let papel = String(it.papel);
  let tel: string;
  try { tel = normalizarTelefone(it.telefone); } catch { throw new ErroItem('telefone_invalido'); }
  const p = it.paciente as Item | undefined;
  const sistema = p && typeof p === 'object' ? String(p.sistema ?? '') : '';
  const codigo = p && typeof p === 'object' ? String(p.codigo ?? '').trim() : '';
  if (!SISTEMA.test(sistema) || !codigo || codigo.length > 40) throw new ErroItem('sem_paciente');
  const nome = String(it.nome ?? '').trim().slice(0, 120) || null;
  const [ddd, fim] = chaveTelefone(tel);

  const ap = await c.query(`select contato_id from agenda_pacientes where sistema = $1 and paciente_id = $2`, [sistema, codigo]);
  const doPaciente = ap.rows[0]?.contato_id ? await contato(c, String(ap.rows[0].contato_id)) : null;

  if (it.remover === true) {
    if (!doPaciente) return { indice, ok: true, removido: false };
    const r = await c.query(
      `update contato_telefones set arquivado = true, atualizado_em = now()
        where contato_id = $1 and substr(telefone, 3, 2) = $2 and right(telefone, 8) = $3 and not arquivado`, [doPaciente.id, ddd, fim]);
    return { indice, ok: true, contato_id: doPaciente.id, removido: (r.rowCount ?? 0) > 0 };
  }

  const donoR = await c.query(
    `select id from contatos where not arquivado and substr(regexp_replace(telefone, '\\D', '', 'g'), 3, 2) = $1
        and right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $2 order by criado_em limit 1`, [ddd, fim]);
  const dono = donoR.rows[0] ? await contato(c, String(donoR.rows[0].id)) : null;

  // Um dono por número: se o número já tem titular carregado e este "proprio" é outra pessoa (outro nome, e não o
  // mesmo CPF), ele entra como mesmo_numero e não troca o dono nem o nome dele.
  let jaTemProprio = false;
  if (papel === 'proprio' && dono && nome && normNome(dono.nome) !== normNome(nome)) {
    const cpfItem = digitos(it.cpf);
    const t = await c.query(
      `select 1 from contato_telefones where contato_id = $1 and papel = 'proprio' and not arquivado and substr(telefone, 3, 2) = $2 and right(telefone, 8) = $3`,
      [dono.id, ddd, fim]);
    if (t.rowCount && !(cpfItem && digitos(dono.documento) === cpfItem)) { papel = 'mesmo_numero'; jaTemProprio = true; }
  }

  let alvo: Contato;
  let criado = false, separado = false;
  if (papel === 'proprio') {
    if (dono) alvo = dono;
    else if (doPaciente && !doPaciente.telefone) {
      await c.query(`update contatos set telefone = $2, atualizado_em = now() where id = $1`, [doPaciente.id, tel]);
      alvo = { ...doPaciente, telefone: tel };
    } else { alvo = await novoContato(c, nome, tel); criado = true; }
  } else {
    const podeFicar = (k: Contato) => ['mesmo_numero', 'equipe_fornecedor'].includes(papel) && !!nome && normNome(k.nome) === normNome(nome);
    if (doPaciente) {
      if (!mesmoNumero(doPaciente.telefone, tel) || podeFicar(doPaciente)) alvo = doPaciente;
      else { alvo = await novoContato(c, nome, null); criado = true; separado = true; }
    } else if (dono && podeFicar(dono)) alvo = dono;
    else { alvo = await novoContato(c, nome, null); criado = true; }
  }

  // CPF: só em contato sem CPF; outro CPF não troca; CPF de outro contato não grava.
  let aviso: string | undefined, contatoCpf: string | undefined, cpf: string | null = null;
  const cpfDig = digitos(it.cpf);
  if (it.cpf !== undefined && it.cpf !== null && it.cpf !== '') {
    if (cpfValido(cpfDig)) cpf = cpfDig; else aviso = 'cpf_invalido';
  }
  const docAlvo = digitos(alvo.documento);
  if (cpf) {
    const outro = await c.query(
      `select id from contatos where not arquivado and id <> $1 and regexp_replace(coalesce(documento, ''), '\\D', '', 'g') = $2 limit 1`, [alvo.id, cpf]);
    if (outro.rowCount) { aviso = 'cpf_em_outro_contato'; contatoCpf = String(outro.rows[0].id); }
    else if (!docAlvo) await c.query(`update contatos set documento = $2, tipo_documento = 'cpf', atualizado_em = now() where id = $1`, [alvo.id, cpf]);
    else if (docAlvo !== cpf) aviso = 'cpf_diferente';
  }
  // Nome do cadastro do sistema: contato novo já nasce com ele; o dono do número passa a ter o nome do titular,
  // a não ser que já tenha outro CPF. Dependente separado já nasce com o nome dele.
  if (nome && !criado && alvo.nome !== nome && (!docAlvo || docAlvo === cpf) && (papel === 'proprio' || !alvo.nome)) {
    await c.query(`update contatos set nome = $2, atualizado_em = now() where id = $1`, [alvo.id, nome]);
  }

  // O paciente passa a apontar para o contato certo; os agendamentos dele (e os comprovantes desses) vão junto.
  let movidos = 0;
  const antigo = doPaciente?.id ?? (ap.rows[0]?.contato_id ? String(ap.rows[0].contato_id) : null);
  await c.query(
    `insert into agenda_pacientes (sistema, paciente_id, contato_id, nome, telefone) values ($1, $2, $3, $4, $5)
     on conflict (sistema, paciente_id) do update set contato_id = excluded.contato_id, nome = coalesce(excluded.nome, agenda_pacientes.nome),
       telefone = coalesce(agenda_pacientes.telefone, excluded.telefone), atualizado_em = now()`,
    [sistema, codigo, alvo.id, nome, tel]);
  if (antigo && antigo !== alvo.id) {
    const m = await c.query(
      `update servicos set contato_id = $1, atualizado_em = now()
        where sistema = $2 and detalhes->'${sistema}'->>'paciente_id' = $3 and contato_id = $4 returning id`, [alvo.id, sistema, codigo, antigo]);
    movidos = m.rowCount ?? 0;
    if (movidos) {
      await c.query(`update pagamentos set contato_id = $1, atualizado_em = now() where servico_id = any($2::uuid[]) and contato_id = $3`,
        [alvo.id, m.rows.map((x) => x.id), antigo]);
    }
  }

  await c.query(
    `insert into contato_telefones (contato_id, telefone, papel, origem) values ($1, $2, $3, $4)
     on conflict (contato_id, substr(telefone, 3, 2), right(telefone, 8)) do update set
       telefone = excluded.telefone, papel = excluded.papel, origem = coalesce(excluded.origem, contato_telefones.origem), arquivado = false, atualizado_em = now()
     where contato_telefones.papel is distinct from excluded.papel or contato_telefones.arquivado or contato_telefones.telefone is distinct from excluded.telefone`,
    [alvo.id, tel, papel, origem]);

  const r: ResultadoItem = { indice, ok: true, contato_id: alvo.id, criado };
  if (separado) r.separado = true;
  if (movidos) r.servicos_movidos = movidos;
  if (jaTemProprio) { r.aviso = aviso ? `ja_tem_proprio,${aviso}` : 'ja_tem_proprio'; r.papel_gravado = 'mesmo_numero'; }
  else if (aviso) r.aviso = aviso;
  if (contatoCpf) r.contato_cpf = contatoCpf;
  return r;
}

export async function carregarPessoas(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = corpo as Item | null;
  const itens = d && typeof d === 'object' ? d.itens : null;
  if (!Array.isArray(itens) || !itens.length) throw new ErroApi(400, 'Envie {"origem"?, "itens": [{telefone, papel, paciente: {sistema, codigo}, nome?, cpf?, remover?}]}.');
  if (itens.length > MAX) throw new ErroApi(400, `No máximo ${MAX} itens por chamada.`);
  const origem = String(d?.origem ?? '').trim().slice(0, 60) || null;

  // O mesmo CPF para pacientes diferentes no mesmo lote: nenhum dos dois é gravado.
  const cpfPac = new Map<string, Set<string>>();
  itens.forEach((it: Item) => {
    const cpf = digitos(it?.cpf);
    const p = it?.paciente as Item | undefined;
    if (cpf.length === 11 && p) (cpfPac.get(cpf) ?? cpfPac.set(cpf, new Set()).get(cpf)!).add(`${p.sistema}:${p.codigo}`);
  });
  const conflito = (it: Item) => { const cpf = digitos(it?.cpf); return cpf.length === 11 && (cpfPac.get(cpf)?.size ?? 0) > 1; };

  const ordem = itens.map((it, i) => ({ it: (it ?? {}) as Item, i }))
    .sort((a, b) => Number(a.it.papel !== 'proprio') - Number(b.it.papel !== 'proprio') || a.i - b.i);
  const saida: ResultadoItem[] = new Array(itens.length);

  await transacao(async (c) => {
    try { await c.query(`select 1 from contato_telefones limit 1`); } catch (e) {
      if ((e as { code?: string }).code === '42P01') throw new ErroApi(503, 'Várias pessoas por número ainda não foram instaladas no banco desta empresa (migração 024).');
      throw e;
    }
    for (const { it, i } of ordem) {
      if (conflito(it)) { saida[i] = { indice: i, ok: false, erro: 'cpf_conflito_no_lote' }; continue; }
      await c.query('savepoint item');
      try {
        saida[i] = await umItem(c, it, origem, i);
        await c.query('release savepoint item');
        await auditar(c, chave, 'carregar', 'contatos', saida[i].contato_id ?? null, {
          origem, papel: it.papel, paciente: it.paciente, criado: saida[i].criado, separado: saida[i].separado,
          servicos_movidos: saida[i].servicos_movidos, removido: saida[i].removido, cpf: it.cpf ? (saida[i].aviso ?? 'enviado') : undefined,
        });
      } catch (e) {
        await c.query('rollback to savepoint item');
        if (e instanceof ErroItem) { saida[i] = { indice: i, ok: false, erro: e.message }; continue; }
        throw e;
      }
    }
  }, bancoDe(chave));

  const erros = saida.filter((x) => !x.ok).length;
  return { total: saida.length, ok: saida.length - erros, erros, itens: saida };
}
