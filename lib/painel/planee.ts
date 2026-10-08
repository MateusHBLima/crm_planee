import 'server-only';
import type { Pool } from 'pg';
import { bancoDaEmpresa, central, ErroApi, registrarErro } from '@/lib/db';
import type { Usuario } from '@/lib/sessao';
import { auditar } from './gestao';
import { TIPOS_EQUIPE, TIPOS_SISTEMA } from './avisos';

// Interno Planee (08/10): saúde dos clientes, novidades e manutenção, integrações com validade de token.
// A saúde lê o banco central (avisos, integrações) e o banco de cada empresa (WhatsApp), em paralelo e com prazo:
// uma empresa com banco fora do ar aparece como problema, sem travar a tela das outras.

const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_EMPRESA = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const texto = (v: unknown, max: number) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };
function exigirMaster(u: Usuario) { if (!u.master) throw new ErroApi(403, 'Só a Planee (master) vê esta parte.'); }
function faltaMigracao(e: unknown): never {
  if (semTabela(e)) throw new ErroApi(503, 'O Interno Planee ainda não foi instalado no banco central (migração 015).');
  throw e;
}

// Espera no máximo `ms`; passou disso, a empresa aparece como "banco sem resposta".
async function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error('prazo')), ms); })]);
  } finally { if (t) clearTimeout(t); }
}

// ---------------- Novidades e manutenção ----------------

export type Novidade = {
  id: string; tipo: 'novidade' | 'manutencao'; titulo: string; texto: string; empresa_id: string | null; empresa_nome: string | null;
  inicio: string; fim: string | null; criado_por: string | null; criado_em: string; arquivado: boolean;
};
const limparNovidade = (r: Record<string, unknown>): Novidade => ({
  id: String(r.id), tipo: r.tipo === 'manutencao' ? 'manutencao' : 'novidade', titulo: String(r.titulo), texto: String(r.texto),
  empresa_id: (r.empresa_id as string) ?? null, empresa_nome: (r.empresa_nome as string) ?? null,
  inicio: iso(r.inicio) as string, fim: iso(r.fim), criado_por: (r.criado_por as string) ?? null, criado_em: iso(r.criado_em) as string,
  arquivado: Boolean(r.arquivado),
});

// O que a empresa vê: manutenções ainda não terminadas (inclusive as agendadas) e novidades dos últimos 90 dias.
export async function novidadesDaEmpresa(u: Usuario): Promise<Novidade[]> {
  if (!u.empresa) return [];
  try {
    const r = await central().query(
      `select n.*, null as empresa_nome from novidades n
        where not n.arquivado and (n.empresa_id is null or n.empresa_id = $1)
          and ((n.tipo = 'manutencao' and (n.fim is null or n.fim > now()))
            or (n.tipo = 'novidade' and n.inicio <= now() and n.inicio > now() - interval '90 days'))
        order by (n.tipo = 'manutencao') desc, n.inicio desc limit 30`, [u.empresa.id]);
    return r.rows.map(limparNovidade);
  } catch (e) { if (semTabela(e)) return []; throw e; }
}

// Faixa no topo de todas as telas: manutenção em andamento ou nos próximos 3 dias, e novidades dos últimos 14 dias.
export async function faixaDaEmpresa(u: Usuario): Promise<{ manutencoes: Novidade[]; novidades: Novidade[] }> {
  const todas = await novidadesDaEmpresa(u);
  const agora = Date.now();
  return {
    manutencoes: todas.filter((n) => n.tipo === 'manutencao' && new Date(n.inicio).getTime() <= agora + 3 * 86400_000),
    novidades: todas.filter((n) => n.tipo === 'novidade' && new Date(n.inicio).getTime() > agora - 14 * 86400_000).slice(0, 3),
  };
}

export async function listarNovidades(u: Usuario): Promise<Novidade[]> {
  exigirMaster(u);
  try {
    const r = await central().query(
      `select n.*, e.nome as empresa_nome from novidades n left join empresas e on e.id = n.empresa_id
        order by n.arquivado, n.inicio desc limit 200`);
    return r.rows.map(limparNovidade);
  } catch (e) { if (semTabela(e)) return []; throw e; }
}

const data = (v: unknown, campo: string): Date | null => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ErroApi(400, `${campo}: data inválida.`);
  return d;
};

export async function salvarNovidade(u: Usuario, d: { id?: unknown; tipo: unknown; titulo: unknown; texto: unknown; empresa_id?: unknown; inicio?: unknown; fim?: unknown }) {
  exigirMaster(u);
  const tipo = d.tipo === 'manutencao' ? 'manutencao' : d.tipo === 'novidade' ? 'novidade' : null;
  if (!tipo) throw new ErroApi(400, 'Escolha: novidade ou manutenção.');
  const titulo = texto(d.titulo, 120);
  if (!titulo || titulo.length < 3) throw new ErroApi(400, 'Título: de 3 a 120 caracteres.');
  const corpo = texto(d.texto, 2000);
  if (!corpo) throw new ErroApi(400, 'Escreva o texto.');
  const empresa = texto(d.empresa_id, 40);
  if (empresa && !ID_EMPRESA.test(empresa)) throw new ErroApi(400, 'Empresa inválida.');
  const inicio = data(d.inicio, 'Início') ?? new Date();
  const fim = data(d.fim, 'Fim');
  if (fim && fim <= inicio) throw new ErroApi(400, 'O fim precisa ser depois do início.');
  const id = d.id ? String(d.id) : null;
  if (id && !UUID.test(id)) throw new ErroApi(404, 'Novidade não encontrada.');
  try {
    if (empresa) {
      const e = await central().query('select 1 from empresas where id = $1', [empresa]);
      if (!e.rowCount) throw new ErroApi(400, 'Empresa não encontrada.');
    }
    const r = id
      ? await central().query(
        `update novidades set tipo = $2, titulo = $3, texto = $4, empresa_id = $5, inicio = $6, fim = $7 where id = $1 returning id`,
        [id, tipo, titulo, corpo, empresa, inicio, fim])
      : await central().query(
        `insert into novidades (tipo, titulo, texto, empresa_id, inicio, fim, criado_por) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [tipo, titulo, corpo, empresa, inicio, fim, u.nome]);
    if (!r.rowCount) throw new ErroApi(404, 'Novidade não encontrada.');
    await auditar(central(), u, empresa, id ? 'editar_novidade' : 'publicar_novidade', r.rows[0].id, { tipo, titulo }).catch(() => undefined);
  } catch (e) { if (e instanceof ErroApi) throw e; faltaMigracao(e); }
}

export async function arquivarNovidade(u: Usuario, id: string, arquivado = true) {
  exigirMaster(u);
  if (!UUID.test(id)) throw new ErroApi(404, 'Novidade não encontrada.');
  const r = await central().query('update novidades set arquivado = $2 where id = $1 returning empresa_id', [id, arquivado]).catch(faltaMigracao);
  if (!r.rowCount) throw new ErroApi(404, 'Novidade não encontrada.');
  await auditar(central(), u, r.rows[0].empresa_id, arquivado ? 'arquivar_novidade' : 'reabrir_novidade', id, undefined).catch(() => undefined);
}

// ---------------- Integrações (validade do token) ----------------

export type Integracao = {
  id: string; empresa_id: string; empresa_nome: string | null; sistema: string; rotulo: string | null; token_valido_ate: string | null;
  dias: number | null; observacao: string | null; ativo: boolean; atualizado_em: string; atualizado_por: string | null;
};
const SQL_INTEGRACOES = `select i.id, i.empresa_id, e.nome as empresa_nome, i.sistema, i.rotulo, to_char(i.token_valido_ate, 'YYYY-MM-DD') as token_valido_ate,
       (i.token_valido_ate - (now() at time zone $1)::date) as dias, i.observacao, i.ativo, i.atualizado_em, i.atualizado_por
  from empresa_integracoes i join empresas e on e.id = i.empresa_id`;
const limparIntegracao = (r: Record<string, unknown>): Integracao => ({
  id: String(r.id), empresa_id: String(r.empresa_id), empresa_nome: (r.empresa_nome as string) ?? null, sistema: String(r.sistema),
  rotulo: (r.rotulo as string) ?? null, token_valido_ate: (r.token_valido_ate as string) ?? null, dias: r.dias === null ? null : Number(r.dias),
  observacao: (r.observacao as string) ?? null, ativo: Boolean(r.ativo), atualizado_em: iso(r.atualizado_em) as string, atualizado_por: (r.atualizado_por as string) ?? null,
});
export const fusoPlanee = () => process.env.PAINEL_FUSO || 'America/Sao_Paulo';

export async function listarIntegracoes(u: Usuario, empresaId?: string | null): Promise<Integracao[]> {
  exigirMaster(u);
  try {
    const r = await central().query(
      `${SQL_INTEGRACOES} where ($2::text is null or i.empresa_id = $2) order by i.ativo desc, i.token_valido_ate nulls last, e.nome`,
      [fusoPlanee(), empresaId || null]);
    return r.rows.map(limparIntegracao);
  } catch (e) { if (semTabela(e)) return []; throw e; }
}

export async function salvarIntegracao(u: Usuario, d: { empresa_id: unknown; sistema: unknown; rotulo?: unknown; token_valido_ate?: unknown; observacao?: unknown; ativo?: unknown }) {
  exigirMaster(u);
  const empresa = texto(d.empresa_id, 40);
  if (!empresa || !ID_EMPRESA.test(empresa)) throw new ErroApi(400, 'Escolha a empresa.');
  const sistema = texto(d.sistema, 40)?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sistema || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(sistema)) throw new ErroApi(400, 'Sistema: use o nome dele, por exemplo "feegow".');
  const validade = texto(d.token_valido_ate, 10);
  if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) throw new ErroApi(400, 'Validade do token: data inválida.');
  const ativo = d.ativo === undefined ? true : Boolean(d.ativo);
  try {
    const e = await central().query('select 1 from empresas where id = $1', [empresa]);
    if (!e.rowCount) throw new ErroApi(400, 'Empresa não encontrada.');
    const r = await central().query(
      `insert into empresa_integracoes (empresa_id, sistema, rotulo, token_valido_ate, observacao, ativo, atualizado_por)
       values ($1,$2,$3,$4::date,$5,$6,$7)
       on conflict (empresa_id, sistema) do update set rotulo = excluded.rotulo, token_valido_ate = excluded.token_valido_ate,
              observacao = excluded.observacao, ativo = excluded.ativo, atualizado_por = excluded.atualizado_por, atualizado_em = now()
       returning id`,
      [empresa, sistema, texto(d.rotulo, 80), validade, texto(d.observacao, 500), ativo, u.nome]);
    await auditar(central(), u, empresa, 'salvar_integracao', r.rows[0].id, { sistema, token_valido_ate: validade, ativo }).catch(() => undefined);
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    if ((e as { code?: string }).code === '22008' || (e as { code?: string }).code === '22007') throw new ErroApi(400, 'Validade do token: data inválida.');
    faltaMigracao(e);
  }
}

// ---------------- Saúde dos clientes ----------------

export type Nivel = 'ok' | 'atencao' | 'problema';
export type SaudeLinha = {
  id: string; nome: string; ativo: boolean; banco: 'ok' | 'erro'; banco_erro: string | null;
  ultima_entrada: string | null; entradas_24h: number | null; saidas_24h: number | null; falhas_24h: number | null; eventos_erro_24h: number | null;
  avisos_abertos: number; avisos_em_analise: number; avisos_sistema_abertos: number;
  token: { sistema: string; rotulo: string | null; valido_ate: string; dias: number } | null;
  nivel: Nivel; motivos: string[];
};
type Metricas = Pick<SaudeLinha, 'ultima_entrada' | 'entradas_24h' | 'saidas_24h' | 'falhas_24h' | 'eventos_erro_24h'>;

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function metricasDaEmpresa(b: Pool): Promise<Metricas> {
  const r = await b.query(
    `select (select max(ultima_entrada_em) from wa_conversas) as ultima_entrada,
            count(*) filter (where direcao = 'entrada') as entradas_24h,
            count(*) filter (where direcao = 'saida') as saidas_24h,
            count(*) filter (where direcao = 'saida' and status = 'falhou') as falhas_24h
       from wa_mensagens where enviada_em > now() - interval '24 hours'`);
  const x = r.rows[0] ?? {};
  let eventos: number | null = null;
  try {
    const e = await b.query(`select count(*) as c from wa_eventos where erro is not null and processado_em is null and recebido_em > now() - interval '24 hours'`);
    eventos = n(e.rows[0]?.c);
  } catch (e) { if (!semTabela(e)) throw e; }
  return { ultima_entrada: iso(x.ultima_entrada), entradas_24h: n(x.entradas_24h), saidas_24h: n(x.saidas_24h), falhas_24h: n(x.falhas_24h), eventos_erro_24h: eventos };
}

function classificar(l: Omit<SaudeLinha, 'nivel' | 'motivos'>): { nivel: Nivel; motivos: string[] } {
  const problema: string[] = []; const atencao: string[] = [];
  if (l.banco === 'erro') problema.push('Banco da empresa sem resposta');
  if (l.token && l.token.dias < 0) problema.push(`Token ${l.token.rotulo || l.token.sistema} vencido`);
  else if (l.token && l.token.dias <= 30) atencao.push(`Token ${l.token.rotulo || l.token.sistema} vence em ${l.token.dias} ${l.token.dias === 1 ? 'dia' : 'dias'}`);
  if (l.avisos_sistema_abertos) problema.push(`${l.avisos_sistema_abertos} ${l.avisos_sistema_abertos === 1 ? 'alerta automático aberto' : 'alertas automáticos abertos'}`);
  if ((l.falhas_24h ?? 0) >= 10) problema.push(`${l.falhas_24h} envios falharam em 24 h`);
  else if ((l.falhas_24h ?? 0) > 0) atencao.push(`${l.falhas_24h} ${l.falhas_24h === 1 ? 'envio falhou' : 'envios falharam'} em 24 h`);
  if ((l.eventos_erro_24h ?? 0) > 0) atencao.push(`${l.eventos_erro_24h} eventos da Meta com erro no receptor`);
  if (l.avisos_abertos) atencao.push(`${l.avisos_abertos} ${l.avisos_abertos === 1 ? 'aviso da equipe aberto' : 'avisos da equipe abertos'}`);
  if (!l.ativo) return { nivel: 'ok', motivos: ['Empresa desativada'] };
  return problema.length ? { nivel: 'problema', motivos: [...problema, ...atencao] } : atencao.length ? { nivel: 'atencao', motivos: atencao } : { nivel: 'ok', motivos: [] };
}

type EmpresaRef = { id: string; nome: string; ativo: boolean; banco_url_cifrado: string | null };

async function linhaDe(e: EmpresaRef, contagens: Map<string, { abertos: number; em_analise: number; sistema: number }>, tokens: Map<string, SaudeLinha['token']>): Promise<SaudeLinha> {
  let m: Metricas = { ultima_entrada: null, entradas_24h: null, saidas_24h: null, falhas_24h: null, eventos_erro_24h: null };
  let banco: SaudeLinha['banco'] = 'ok'; let bancoErro: string | null = null;
  try { m = await comPrazo(metricasDaEmpresa(bancoDaEmpresa(e)), 6000); } catch (err) {
    if (err instanceof ErroApi) { banco = 'erro'; bancoErro = err.message; }
    else if (semTabela(err)) { bancoErro = 'Banco sem as tabelas do WhatsApp (migração 008).'; }
    else { banco = 'erro'; bancoErro = (err as Error).message === 'prazo' ? 'O banco não respondeu em 6 s.' : 'Não foi possível ler o banco agora.'; registrarErro(`saúde ${e.id}`, err); }
  }
  const c = contagens.get(e.id) ?? { abertos: 0, em_analise: 0, sistema: 0 };
  const base = { id: e.id, nome: e.nome, ativo: e.ativo, banco, banco_erro: bancoErro, ...m,
    avisos_abertos: c.abertos, avisos_em_analise: c.em_analise, avisos_sistema_abertos: c.sistema, token: tokens.get(e.id) ?? null };
  return { ...base, ...classificar(base) };
}

async function dadosCentrais(empresaId?: string) {
  const contagens = new Map<string, { abertos: number; em_analise: number; sistema: number }>();
  const tokens = new Map<string, SaudeLinha['token']>();
  try {
    const a = await central().query(
      `select empresa_id, count(*) filter (where estado = 'aberto' and origem = 'equipe') as abertos,
              count(*) filter (where estado = 'em_analise') as em_analise,
              count(*) filter (where estado = 'aberto' and origem = 'sistema') as sistema
         from avisos where estado <> 'resolvido' and ($1::text is null or empresa_id = $1) group by empresa_id`, [empresaId ?? null]);
    for (const x of a.rows) contagens.set(String(x.empresa_id), { abertos: Number(x.abertos), em_analise: Number(x.em_analise), sistema: Number(x.sistema) });
    const t = await central().query(
      `select distinct on (empresa_id) empresa_id, sistema, rotulo, to_char(token_valido_ate, 'YYYY-MM-DD') as valido_ate,
              (token_valido_ate - (now() at time zone $1)::date) as dias
         from empresa_integracoes where ativo and token_valido_ate is not null and ($2::text is null or empresa_id = $2)
        order by empresa_id, token_valido_ate`, [fusoPlanee(), empresaId ?? null]);
    for (const x of t.rows) tokens.set(String(x.empresa_id), { sistema: x.sistema, rotulo: x.rotulo ?? null, valido_ate: x.valido_ate, dias: Number(x.dias) });
  } catch (e) { if (!semTabela(e)) throw e; }
  return { contagens, tokens };
}

const ORDEM: Record<Nivel, number> = { problema: 0, atencao: 1, ok: 2 };

export async function saudeClientes(u: Usuario): Promise<SaudeLinha[]> {
  exigirMaster(u);
  const emp = await central().query('select id, nome, ativo, banco_url_cifrado from empresas order by ativo desc, nome');
  const { contagens, tokens } = await dadosCentrais();
  const linhas = await Promise.all(emp.rows.map((e: EmpresaRef) => linhaDe(e, contagens, tokens)));
  return linhas.sort((a, b) => Number(b.ativo) - Number(a.ativo) || ORDEM[a.nivel] - ORDEM[b.nivel] || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export type SaudeNumero = { numero_id: string; nome: string | null; ultima_entrada: string | null; entradas_24h: number; saidas_24h: number; falhas_24h: number; entradas_7d: number };
export type SaudeEmpresa = {
  linha: SaudeLinha; numeros: SaudeNumero[]; falhas: { em: string; numero_id: string; codigo: string | null; titulo: string | null }[];
  integracoes: Integracao[]; avisos: { id: string; tipo_nome: string; titulo: string; estado: string; criado_em: string; origem: string }[];
};

export async function saudeEmpresa(u: Usuario, id: string): Promise<SaudeEmpresa> {
  exigirMaster(u);
  if (!ID_EMPRESA.test(id)) throw new ErroApi(404, 'Empresa não encontrada.');
  const emp = await central().query('select id, nome, ativo, banco_url_cifrado from empresas where id = $1', [id]);
  if (!emp.rowCount) throw new ErroApi(404, 'Empresa não encontrada.');
  const e = emp.rows[0] as EmpresaRef;
  const { contagens, tokens } = await dadosCentrais(id);
  const linha = await linhaDe(e, contagens, tokens);
  let numeros: SaudeNumero[] = []; let falhas: SaudeEmpresa['falhas'] = [];
  if (linha.banco === 'ok') {
    try {
      const b = bancoDaEmpresa(e);
      const [r, f] = await comPrazo(Promise.all([
        b.query(
          `select m.numero_id, (select max(ultima_entrada_em) from wa_conversas c where c.numero_id = m.numero_id) as ultima_entrada,
                  count(*) filter (where direcao = 'entrada' and enviada_em > now() - interval '24 hours') as entradas_24h,
                  count(*) filter (where direcao = 'saida' and enviada_em > now() - interval '24 hours') as saidas_24h,
                  count(*) filter (where direcao = 'saida' and status = 'falhou' and enviada_em > now() - interval '24 hours') as falhas_24h,
                  count(*) filter (where direcao = 'entrada') as entradas_7d
             from wa_mensagens m where enviada_em > now() - interval '7 days' group by m.numero_id order by entradas_7d desc`),
        // Só o código e o título do erro da Meta (sem telefone nem texto da mensagem).
        b.query(
          `select enviada_em, numero_id, erro->>'code' as codigo, coalesce(erro->>'title', erro->>'message') as titulo
             from wa_mensagens where direcao = 'saida' and status = 'falhou' and enviada_em > now() - interval '7 days'
            order by enviada_em desc limit 8`),
      ]), 6000);
      numeros = r.rows.map((x) => ({ numero_id: String(x.numero_id), nome: null, ultima_entrada: iso(x.ultima_entrada),
        entradas_24h: Number(x.entradas_24h), saidas_24h: Number(x.saidas_24h), falhas_24h: Number(x.falhas_24h), entradas_7d: Number(x.entradas_7d) }));
      falhas = f.rows.map((x) => ({ em: iso(x.enviada_em) as string, numero_id: String(x.numero_id), codigo: x.codigo ?? null, titulo: x.titulo ? String(x.titulo).slice(0, 160) : null }));
    } catch (err) { if (!semTabela(err)) registrarErro(`saúde detalhe ${id}`, err); }
    // Nome de cada número, quando o cadastro do receptor está neste banco central.
    try {
      const nomes = await central().query('select phone_number_id, nome from whatsapp_numeros where empresa_id = $1', [id]);
      const mapa = new Map(nomes.rows.map((x) => [String(x.phone_number_id), (x.nome as string) ?? null]));
      numeros = numeros.map((x) => ({ ...x, nome: mapa.get(x.numero_id) ?? null }));
    } catch { /* receptor com outro banco central: fica o id do número */ }
  }
  const integracoes = await listarIntegracoes(u, id);
  let avisos: SaudeEmpresa['avisos'] = [];
  try {
    const a = await central().query(
      `select id, tipo, titulo, estado, criado_em, origem from avisos where empresa_id = $1 order by (estado = 'resolvido'), criado_em desc limit 20`, [id]);
    avisos = a.rows.map((x) => ({ id: String(x.id), tipo_nome: TIPOS_EQUIPE[x.tipo] ?? TIPOS_SISTEMA[x.tipo] ?? x.tipo, titulo: x.titulo, estado: x.estado,
      criado_em: iso(x.criado_em) as string, origem: x.origem }));
  } catch (err) { if (!semTabela(err)) throw err; }
  return { linha, numeros, falhas, integracoes, avisos };
}
