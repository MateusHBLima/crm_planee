import 'server-only';
import type { Pool } from 'pg';
import { bancoDaEmpresa, central, registrarErro, type RefEmpresa } from '@/lib/db';
import { chaveTelefone, normalizarTelefone, SQL_MESMO_TELEFONE } from '@/lib/telefone';
import { randomUUID } from 'node:crypto';
import { clienteFeegow, ErroFeegow, feegowDeIso, isoDeFeegow, marcadoEm, situacaoDoStatus, tokenFeegow, valorReais, type AgendamentoFeegow } from './feegow';

// Espelho da agenda da Feegow (09/10). Robô só de leitura: a cada rodada, para cada empresa com a integração
// "feegow" ativa (Interno → Integrações) e o token na stack (FEEGOW_TOKENS), ele
//   1. relê os próximos dias (3 dias atrás até 60 dias à frente) de cada profissional ativo;
//   2. continua a carga do histórico, uma janela de 30 dias por vez, do mais novo para o mais antigo, até achar
//      um ano inteiro vazio (ou 2015);
//   3. grava cada agendamento em "servicos" (sistema 'feegow', código = id do agendamento), ligado ao contato do
//      paciente (achado pelo telefone ou criado). Sara e espelho gravam no mesmo registro: não duplica.
// Limite de chamadas à Feegow por rodada (AGENDA_CHAMADAS, padrão 80): a carga do histórico anda aos poucos e
// não disputa a API com a Sara. Duas réplicas do painel não rodam juntas (vez marcada em agenda_espelho).
// Nada é apagado: agendamento desmarcado na Feegow vira "cancelado" no CRM.

const SISTEMA = 'feegow';
const FUTURO_DIAS = 60;
const PASSADO_RECENTE_DIAS = 3;
const JANELA_DIAS = 30;
const ANO_VAZIO = 12;            // 12 janelas de 30 dias sem nada: a carga do histórico terminou
const INICIO_MINIMO = '2015-01-01';
const CADASTROS_HORAS = 24;
const TEMPO_MAX_MS = 6 * 60_000;  // uma rodada para antes disso; a vez dura 9 min (a outra réplica não entra no meio)
const orcamentoPadrao = () => Number(process.env.AGENDA_CHAMADAS) || 80;
const fuso = () => process.env.PAINEL_FUSO || 'America/Sao_Paulo';

export type ResumoEspelho = {
  empresa: string; situacao: 'ok' | 'parcial' | 'sem_token' | 'sem_migracao' | 'ocupado' | 'erro';
  chamadas: number; lidos: number; gravados: number; novos_contatos: number; carga_ate: string | null; carga_completa: boolean; erro?: string;
};

type Cadastros = { profissionais: Record<string, string>; ativos: string[]; locais: Record<string, string>; status: Record<string, string>; procedimentos: Record<string, string> };

const somaDias = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hojeNoFuso = () => new Intl.DateTimeFormat('en-CA', { timeZone: fuso(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

class SemOrcamento extends Error {}

export async function sincronizarEmpresa(e: RefEmpresa, opcoes: { orcamento?: number } = {}): Promise<ResumoEspelho> {
  const resumo: ResumoEspelho = { empresa: e.id, situacao: 'ok', chamadas: 0, lidos: 0, gravados: 0, novos_contatos: 0, carga_ate: null, carga_completa: false };
  const token = tokenFeegow(e.id);
  if (!token) return { ...resumo, situacao: 'sem_token' };
  const db = bancoDaEmpresa(e);
  const tem = await db.query(`select to_regclass('agenda_espelho') is not null and to_regclass('servicos') is not null as tem`);
  if (!tem.rows[0]?.tem) return { ...resumo, situacao: 'sem_migracao' };

  await db.query(`insert into agenda_espelho (sistema) values ($1) on conflict (sistema) do nothing`, [SISTEMA]);
  const rodada = randomUUID();
  const vez = await db.query(
    `update agenda_espelho set rodando_ate = now() + interval '9 minutes', rodando_por = $2, ultima_rodada = now()
      where sistema = $1 and (rodando_ate is null or rodando_ate < now()) returning *`, [SISTEMA, rodada]);
  if (!vez.rowCount) return { ...resumo, situacao: 'ocupado' };
  const estado = vez.rows[0];
  resumo.carga_ate = estado.carga_ate ? new Date(estado.carga_ate).toISOString().slice(0, 10) : null;
  resumo.carga_completa = Boolean(estado.carga_completa);

  const contador = { chamadas: 0 };
  const orcamento = opcoes.orcamento ?? orcamentoPadrao();
  const cli = clienteFeegow(token, contador);
  const comeco = Date.now();
  // Antes de cada chamada: para (sem perder o que gravou) quando acaba o limite de chamadas ou o tempo da rodada.
  const gastar = () => { if (contador.chamadas >= orcamento || Date.now() - comeco > TEMPO_MAX_MS) throw new SemOrcamento(); };

  try {
    // 1) Cadastros (nomes de profissionais, locais, status e procedimentos), uma vez por dia.
    let cad = estado.cadastros as Cadastros;
    const velhos = !estado.cadastros_em || Date.now() - new Date(estado.cadastros_em).getTime() > CADASTROS_HORAS * 3600_000 || !cad?.profissionais;
    if (velhos) {
      const [ativos, inativos, locais, status, tipos] = await Promise.all([cli.profissionais(1), cli.profissionais(0), cli.locais(), cli.status(), cli.tiposProcedimento()]);
      // Sem nenhum profissional, a carga "terminaria" sem ler nada: é erro (token sem acesso, conta errada).
      if (!ativos.length && !inativos.length) throw new ErroFeegow(0, 'A Feegow não devolveu nenhum profissional: confira o token e as permissões dele.');
      const procs: Record<string, string> = {};
      for (const t of tipos.slice(0, 12)) { gastar(); for (const p of await cli.procedimentos(Number(t.id))) procs[String(p.procedimento_id)] = String(p.nome ?? '').trim(); }
      const nomeProf = (p: { profissional_id: number; nome: string | null; tratamento?: string | null }) => [p.tratamento, p.nome].filter(Boolean).join(' ').trim() || `Profissional ${p.profissional_id}`;
      cad = {
        profissionais: Object.fromEntries([...ativos, ...inativos].map((p) => [String(p.profissional_id), nomeProf(p)])),
        ativos: ativos.map((p) => String(p.profissional_id)),
        locais: Object.fromEntries(locais.map((l) => [String(l.id), String(l.local ?? '').trim()])),
        status: Object.fromEntries(status.map((s) => [String(s.id), String(s.status ?? '').trim()])),
        procedimentos: procs,
      };
      await db.query(`update agenda_espelho set cadastros = $2::jsonb, cadastros_em = now() where sistema = $1`, [SISTEMA, JSON.stringify(cad)]);
    }
    const todos = Object.keys(cad.profissionais);
    if (!todos.length) throw new ErroFeegow(0, 'A Feegow não devolveu nenhum profissional: confira o token e as permissões dele.');

    // Uma janela de um profissional: lê, garante os pacientes e grava. Sem orçamento no meio: para (sem perder o
    // que já gravou; a janela é relida na próxima rodada).
    const janela = async (prof: string, de: string, ate: string): Promise<number> => {
      gastar();
      const lista = await cli.agendamentos(prof, feegowDeIso(de), feegowDeIso(ate));
      resumo.lidos += lista.length;
      for (const ag of lista) {
        const pac = await contatoDoPaciente(db, cli, ag.paciente_id, gastar, resumo);
        if (!pac) continue;
        await gravarAgendamento(db, ag, pac, cad);
        resumo.gravados++;
      }
      return lista.length;
    };

    // 2) Próximos dias, profissionais ativos.
    const hoje = hojeNoFuso();
    const ini = somaDias(hoje, -PASSADO_RECENTE_DIAS);
    for (const prof of cad.ativos.length ? cad.ativos : todos) {
      for (let de = ini; de <= somaDias(hoje, FUTURO_DIAS); de = somaDias(de, JANELA_DIAS + 1)) {
        await janela(prof, de, somaDias(de, JANELA_DIAS));
      }
    }

    // 3) Carga do histórico, janela por janela, enquanto houver orçamento. Dentro da janela, o progresso fica
    // guardado por profissional: a rodada seguinte continua de onde esta parou, sem reler os que já leu.
    let cursor = resumo.carga_ate ?? ini;
    let vazios = Number(estado.vazios_seguidos) || 0;
    let feitos: string[] = Array.isArray(estado.carga_feitos) ? estado.carga_feitos.map(String) : [];
    let achados = Number(estado.carga_achados) || 0;
    while (!resumo.carga_completa) {
      const ate = somaDias(cursor, -1);
      const de = somaDias(cursor, -JANELA_DIAS);
      for (const prof of todos) {
        if (feitos.includes(prof)) continue;
        achados += await janela(prof, de, ate);
        feitos.push(prof);
        await db.query(`update agenda_espelho set carga_feitos = $2, carga_achados = $3 where sistema = $1`, [SISTEMA, feitos, achados]);
      }
      cursor = de;
      vazios = achados ? 0 : vazios + 1;
      feitos = []; achados = 0;
      resumo.carga_completa = vazios >= ANO_VAZIO || de <= INICIO_MINIMO;
      resumo.carga_ate = cursor;
      await db.query(`update agenda_espelho set carga_ate = $2::date, vazios_seguidos = $3, carga_completa = $4, carga_feitos = '{}', carga_achados = 0 where sistema = $1`,
        [SISTEMA, cursor, vazios, resumo.carga_completa]);
    }
  } catch (err) {
    if (err instanceof SemOrcamento) resumo.situacao = 'parcial';
    else {
      resumo.situacao = 'erro';
      resumo.erro = err instanceof ErroFeegow ? err.message : 'Falha ao ler ou gravar a agenda.';
      registrarErro(`espelho da agenda ${e.id}`, err);
    }
  } finally {
    resumo.chamadas = contador.chamadas;
    await db.query(
      `update agenda_espelho set rodando_ate = null, rodando_por = null, totais = $2::jsonb, ultimo_erro = $3, atualizado_em = now(),
              ultima_ok = case when $3::text is null then now() else ultima_ok end where sistema = $1 and rodando_por = $4`,
      [SISTEMA, JSON.stringify({ chamadas: resumo.chamadas, lidos: resumo.lidos, gravados: resumo.gravados, novos_contatos: resumo.novos_contatos, situacao: resumo.situacao }),
        resumo.erro ?? null, rodada]).catch((x) => registrarErro('espelho da agenda (estado)', x));
  }
  return resumo;
}

// Contato do CRM para o paciente da Feegow: pela ligação já feita; senão lê o paciente na Feegow (uma chamada) e
// acha o contato pelo telefone (com e sem o 9), ou cria um novo com nome e telefone. Paciente que a Feegow não
// devolve fica anotado (sem contato) e só é lido de novo depois de 7 dias.
type Paciente = { contatoId: string; nome: string | null };
async function contatoDoPaciente(db: Pool, cli: ReturnType<typeof clienteFeegow>, pacienteId: unknown, gastar: () => void, resumo: ResumoEspelho): Promise<Paciente | null> {
  const pid = pacienteId === null || pacienteId === undefined || pacienteId === '' || Number(pacienteId) === 0 ? null : String(pacienteId);
  if (!pid) return null;
  const ja = await db.query(
    `select contato_id, nome, atualizado_em > now() - interval '7 days' as recente from agenda_pacientes where sistema = $1 and paciente_id = $2`, [SISTEMA, pid]);
  if (ja.rows[0]?.contato_id) return { contatoId: String(ja.rows[0].contato_id), nome: (ja.rows[0].nome as string) ?? null };
  if (ja.rows[0]?.recente) return null;
  gastar();
  const p = await cli.paciente(pid);
  if (!p) {
    await db.query(
      `insert into agenda_pacientes (sistema, paciente_id) values ($1, $2) on conflict (sistema, paciente_id) do update set atualizado_em = now()`, [SISTEMA, pid]);
    return null;
  }
  const nome = String(p.nome ?? '').trim().slice(0, 120) || null;
  let tel: string | null = null;
  for (const t of [...(p.celulares ?? []), ...(p.telefones ?? [])]) {
    if (!t) continue;
    try { tel = normalizarTelefone(t); break; } catch { /* sem DDD ou inválido: tenta o próximo */ }
  }
  let contatoId: string | null = null;
  if (tel) {
    const achado = await db.query(`select id from contatos where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em limit 1`, chaveTelefone(tel));
    contatoId = achado.rows[0]?.id ? String(achado.rows[0].id) : null;
    if (contatoId && nome) await db.query(`update contatos set nome = $2, atualizado_em = now() where id = $1 and (nome is null or nome = '')`, [contatoId, nome]);
  }
  if (!contatoId) {
    const novo = await db.query(
      `insert into contatos (nome, telefone) values ($1, $2) on conflict (telefone) do update set atualizado_em = now() returning id`, [nome, tel]);
    contatoId = String(novo.rows[0].id);
    resumo.novos_contatos++;
  }
  await db.query(
    `insert into agenda_pacientes (sistema, paciente_id, contato_id, nome, telefone) values ($1, $2, $3, $4, $5)
     on conflict (sistema, paciente_id) do update set contato_id = excluded.contato_id, nome = excluded.nome, telefone = excluded.telefone, atualizado_em = now()`,
    [SISTEMA, pid, contatoId, nome, tel]);
  return { contatoId, nome };
}

// Grava (ou atualiza) o agendamento em "servicos". Campos da Sara que a Feegow não tem (atendimento ligado,
// quem registrou) ficam como estão; os dados da agenda vêm da Feegow, que é a fonte.
async function gravarAgendamento(db: Pool, ag: AgendamentoFeegow, pac: Paciente, cad: Cadastros) {
  const dia = isoDeFeegow(ag.data);
  const hora = /^\d{2}:\d{2}(:\d{2})?$/.test(String(ag.horario ?? '')) ? String(ag.horario) : null;
  if (!dia) return;
  const procId = ag.procedimento_id === null || ag.procedimento_id === undefined ? null : String(ag.procedimento_id);
  const tipo = (procId && cad.procedimentos[procId]) || (ag.retorno ? 'Retorno' : 'Consulta');
  const profissional = ag.profissional_id ? cad.profissionais[String(ag.profissional_id)] ?? null : null;
  const local = ag.telemedicina ? 'Online (teleconsulta)' : (ag.local_id && Number(ag.local_id) ? cad.locais[String(ag.local_id)] ?? null : null) ?? (ag.nome_fantasia || null);
  const detalhes = {
    feegow: {
      status_id: ag.status_id ?? null, status: ag.status_id ? cad.status[String(ag.status_id)] ?? null : null,
      paciente_id: ag.paciente_id ?? null, profissional_id: ag.profissional_id ?? null, procedimento_id: ag.procedimento_id ?? null,
      local_id: ag.local_id ?? null, unidade_id: ag.unidade_id ?? null, canal_id: ag.canal_id ?? null, agendado_por: ag.agendado_por ?? null,
      agendado_em: ag.agendado_em ?? null, encaixe: Boolean(ag.encaixe), telemedicina: Boolean(ag.telemedicina), retorno: Boolean(ag.retorno),
      primeiro: Boolean(ag.primeiro_agendamento), marcado_em: marcadoEm(ag.agendado_em), paciente_nome: pac.nome,
      sincronizado_em: new Date().toISOString(),
    },
  };
  await db.query(
    `insert into servicos (contato_id, tipo, descricao, inicio, profissional, local, valor, situacao, sistema, codigo_externo, detalhes, criado_por)
     values ($1, $2, $3, ($4::date + coalesce($5::time, '00:00'::time)) at time zone $12, $6, $7, $8, $9, 'feegow', $10, $11::jsonb, 'Feegow (espelho)')
     on conflict (sistema, codigo_externo) where codigo_externo is not null do update set
       tipo = excluded.tipo, inicio = excluded.inicio, profissional = excluded.profissional, local = excluded.local,
       valor = coalesce(excluded.valor, servicos.valor), situacao = excluded.situacao,
       detalhes = servicos.detalhes || excluded.detalhes, arquivado = false, atualizado_em = now()
     where servicos.inicio is distinct from excluded.inicio or servicos.situacao is distinct from excluded.situacao
        or servicos.profissional is distinct from excluded.profissional or servicos.local is distinct from excluded.local
        or servicos.tipo is distinct from excluded.tipo or servicos.detalhes->'feegow'->>'status_id' is distinct from excluded.detalhes->'feegow'->>'status_id'`,
    [pac.contatoId, tipo.slice(0, 60), ag.notas ? String(ag.notas).slice(0, 500) : null, dia, hora, profissional, local, valorReais(ag.valor_total_agendamento),
      situacaoDoStatus(ag.status_id, ag.status_id ? cad.status[String(ag.status_id)] : null), String(ag.agendamento_id), JSON.stringify(detalhes), fuso()]);
}

// ---- Rodadas automáticas ----

export async function rodarEspelho(soEmpresa?: string): Promise<ResumoEspelho[]> {
  const saida: ResumoEspelho[] = [];
  let empresas: (RefEmpresa & { nome: string })[] = [];
  try {
    empresas = (await central().query(
      `select e.id, e.nome, e.banco_url_cifrado from empresas e join empresa_integracoes i on i.empresa_id = e.id
        where e.ativo and i.ativo and i.sistema = 'feegow' and ($1::text is null or e.id = $1) order by e.id`, [soEmpresa ?? null])).rows;
  } catch (e) { if (!['42P01', '42703'].includes((e as { code?: string }).code ?? '')) registrarErro('espelho da agenda (empresas)', e); return saida; }
  for (const e of empresas) {
    try { saida.push(await sincronizarEmpresa(e)); } catch (err) {
      registrarErro(`espelho da agenda ${e.id}`, err);
      saida.push({ empresa: e.id, situacao: 'erro', chamadas: 0, lidos: 0, gravados: 0, novos_contatos: 0, carga_ate: null, carga_completa: false, erro: 'Falha ao abrir o banco da empresa.' });
    }
  }
  return saida;
}

const MINUTOS = () => Number(process.env.AGENDA_MINUTOS) || 10;
export function iniciarEspelho() {
  const g = globalThis as unknown as { __espelhoAgenda?: boolean };
  if (g.__espelhoAgenda) return;
  g.__espelhoAgenda = true;
  const rodar = () => { rodarEspelho().catch((e) => registrarErro('espelho da agenda', e)); };
  setTimeout(() => { rodar(); setInterval(rodar, MINUTOS() * 60_000).unref?.(); }, 120_000).unref?.();
}
