import 'server-only';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, type QueryConfig } from 'pg';
import { bancoDaEmpresa, central, ErroApi, registrarErro, transacao, type RefEmpresa } from '@/lib/db';
import { cifrar, cifraConfigurada } from '@/lib/cifra';
import { empresaPorId } from '@/lib/empresa';
import * as api from '@/lib/api/servico';
import type { Chave } from '@/lib/api/auth';
import type { Usuario } from '@/lib/sessao';
import { adicionarPessoa, auditar } from './gestao';
import { pedirNoNumero, salvarNumero } from './numeros';
import { ehModelo, MODELOS_CRM } from './modelos-crm';

// Nova empresa em um formulário só (tela Empresas, 28/10). O Mateus cria o projeto Supabase do cliente, copia a
// connection string do Session pooler (usuário postgres) e preenche nome, apelido, modelo, agente e admin. O painel:
//   1. no banco do cliente, cria o usuário painel_app (senha gerada aqui) e o schema painel, dono painel_app, e roda
//      as migrações da base (supabase/base-empresa.txt) como painel_app, numa transação: nenhuma outra tabela do
//      banco é tocada (exceção à regra 3 aprovada pelo Mateus em 28/10, só para isto);
//   2. guarda cifrada só a connection string do painel_app; a do postgres é usada nesta chamada e esquecida;
//   3. pela API, monta o CRM do modelo (etapas, assuntos, configuração) e a configuração do agente;
//   4. cria a chave da API do n8n (aparece uma vez, na tela);
//   5. no banco central: empresa, módulos do modelo, domínio <apelido>.<PAINEL_DOMINIO_EMPRESAS> e o admin, com o
//      código de primeiro acesso.
// Rodar de novo com o mesmo apelido no mesmo banco continua de onde parou (migrações já feitas não rodam de novo).

function exigirMaster(u: Usuario) {
  if (u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee (master) faz isso.');
}

const ID_EMPRESA = /^[a-z0-9][a-z0-9-]{1,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE = 'painel_app';
const SCHEMA = 'painel';
const RAIZ = () => process.env.PAINEL_RAIZ || process.cwd();
// Sufixo do domínio da empresa nova (o DNS curinga *.planeelabia.com já aponta para o servidor). Nos testes, localhost.
export const sufixoDominio = () => (process.env.PAINEL_DOMINIO_EMPRESAS || 'planeelabia.com').toLowerCase().replace(/^\.+/, '');

// ---- Migrações da base ----

export async function migracoesDaBase(): Promise<{ arquivo: string; id: string; texto: string }[]> {
  let txt: string;
  try { txt = await readFile(path.join(RAIZ(), 'supabase', 'base-empresa.txt'), 'utf8'); } catch {
    throw new ErroApi(500, 'Este servidor não tem a lista das migrações da base (supabase/base-empresa.txt).');
  }
  const lista = txt.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lista.length || lista.some((f) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(f))) throw new ErroApi(500, 'Lista da base inválida (supabase/base-empresa.txt).');
  return Promise.all(lista.map(async (arquivo) => ({
    arquivo, id: `base/${arquivo.slice(0, 3)}`,
    texto: await readFile(path.join(RAIZ(), 'supabase', 'migrations', arquivo), 'utf8'),
  })));
}

// ---- Connection string ----

// Senha só com letras e números (32): não precisa de escape na URL nem no SQL.
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const senhaNova = () => Array.from({ length: 32 }, () => LETRAS[randomInt(LETRAS.length)]).join('');

function lerUrl(texto: unknown): URL {
  const s = String(texto ?? '').trim();
  if (!/^postgres(ql)?:\/\/\S+$/.test(s)) throw new ErroApi(400, 'Banco: cole a connection string do Supabase (Connect → Session pooler), começando com postgresql://.');
  if (/\[YOUR-PASSWORD\]/i.test(s)) throw new ErroApi(400, 'Banco: troque [YOUR-PASSWORD] pela senha do banco do projeto.');
  let u: URL;
  try { u = new URL(s); } catch { throw new ErroApi(400, 'Banco: connection string inválida.'); }
  if (!u.username || !u.password || !u.hostname) throw new ErroApi(400, 'Banco: falta usuário, senha ou endereço na connection string.');
  return u;
}

// Mesma string, com o usuário do painel: no pooler do Supabase o usuário é "<usuário>.<ref do projeto>".
export function urlDoPainelApp(admin: URL, senha: string): string {
  const u = new URL(admin.toString());
  const usuario = decodeURIComponent(u.username);
  const ponto = usuario.indexOf('.');
  u.username = encodeURIComponent(ponto > 0 ? `${ROLE}${usuario.slice(ponto)}` : ROLE);
  u.password = senha;
  return u.toString();
}

const local = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1';
const cliente = (u: URL | string) => {
  const url = typeof u === 'string' ? new URL(u) : u;
  return new Client({
    connectionString: url.toString(), ssl: local(url) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000, statement_timeout: 120000, query_timeout: 120000,
  });
};

function textoErroBanco(e: unknown): string {
  const x = e as { code?: string; message?: string };
  if (e instanceof ErroApi) return e.message;
  if (x.code === '28P01' || /password authentication failed/i.test(x.message ?? '')) return 'Banco: usuário ou senha recusados. Confira a senha do banco do projeto.';
  if (x.code === 'ENOTFOUND' || x.code === 'EAI_AGAIN') return 'Banco: endereço não encontrado. Use a connection string do Session pooler (Connect → Session pooler).';
  if (x.code === 'ENETUNREACH' || x.code === 'ECONNREFUSED' || x.code === 'ETIMEDOUT') return 'Banco: o servidor não alcança este endereço. Use a do Session pooler (a conexão direta do Supabase é só IPv6).';
  if (x.code === '3D000') return 'Banco: o banco de dados não existe (o fim da connection string deve ser /postgres).';
  return 'Banco: não foi possível conectar agora.' + (x.code ? ` (código ${x.code})` : '');
}

// ---- 1. Banco do cliente: usuário, schema e base ----

type Preparo = { url: string; aplicadas: number; ja_feitas: number };

async function prepararBancoDoCliente(admin: URL, empresa: string): Promise<Preparo> {
  const migracoes = await migracoesDaBase();
  const c = cliente(admin);
  try { await c.connect(); } catch (e) { throw new ErroApi(400, textoErroBanco(e)); }
  const senha = senhaNova();
  let atual = '';
  let aplicadas = 0; let jaFeitas = 0;
  try {
    await c.query('begin');
    await c.query(`select pg_advisory_xact_lock(hashtextextended('painel:nova_empresa', 0))`);
    const quem = (await c.query(`select current_user as usuario, rolsuper or rolcreaterole as pode from pg_roles where rolname = current_user`)).rows[0];
    if (!quem?.pode) throw new ErroApi(400, `Banco: o usuário "${quem?.usuario ?? '?'}" não pode criar usuários. Use a connection string com o usuário postgres do projeto.`);
    if (quem.usuario === ROLE) throw new ErroApi(400, 'Banco: esta é a connection string do painel_app. Cole a do usuário postgres (o painel cria o painel_app).');

    // O schema já existe? Só continua se for desta mesma empresa (uma tentativa anterior que parou no meio).
    const temSchema = (await c.query(`select to_regnamespace($1) is not null as tem`, [SCHEMA])).rows[0].tem;
    if (temSchema) {
      const objetos = (await c.query(`select count(*)::int as n from pg_class k join pg_namespace n on n.oid = k.relnamespace
                                       where n.nspname = $1 and k.relkind in ('r','v','m','p','f')`, [SCHEMA])).rows[0].n;
      if (objetos > 0) {
        const dono = (await c.query(`select case when to_regclass('${SCHEMA}.painel_empresa') is null then null
                                          else (select id from ${SCHEMA}.painel_empresa) end as id`)).rows[0]?.id ?? null;
        if (dono !== empresa) {
          throw new ErroApi(409, dono
            ? `Este banco já é da empresa "${dono}" no painel. Nada foi alterado.`
            : `Este banco já tem ${objetos} tabela(s) no schema painel, de fora do painel. Nada foi alterado; fale com o Mateus.`);
        }
      }
    }

    const temRole = (await c.query(`select 1 from pg_roles where rolname = $1`, [ROLE])).rowCount;
    await c.query(`${temRole ? 'alter' : 'create'} role ${ROLE} with login password '${senha}'`);
    // Quem cria precisa ser membro para dar o schema ao painel_app e rodar as migrações como ele.
    await c.query(`grant ${ROLE} to current_user`).catch((e) => { if ((e as { code?: string }).code !== '0LP01') throw e; });
    await c.query(`create schema if not exists ${SCHEMA} authorization ${ROLE}`);
    await c.query(`alter schema ${SCHEMA} owner to ${ROLE}`);
    await c.query(`alter role ${ROLE} set search_path = ${SCHEMA}`);
    await c.query(`set local role ${ROLE}`);
    await c.query(`set local search_path = ${SCHEMA}`);

    const feitas = new Set<string>();
    if ((await c.query(`select to_regclass('painel_migracoes') is not null as tem`)).rows[0].tem) {
      for (const r of (await c.query(`select id from painel_migracoes where modulo = 'base'`)).rows) feitas.add(r.id);
    }
    for (const m of migracoes) {
      if (feitas.has(m.id)) { jaFeitas++; continue; }
      atual = m.arquivo;
      await c.query({ text: m.texto, query_timeout: 120_000 } as QueryConfig);
      aplicadas++;
    }
    atual = '';
    await c.query(`insert into painel_empresa (id) values ($1) on conflict (unico) do nothing`, [empresa]);
    const dono = (await c.query(`select id from painel_empresa`)).rows[0]?.id;
    if (dono !== empresa) throw new ErroApi(409, `Este banco já é da empresa "${dono}" no painel. Nada foi alterado.`);
    for (const m of migracoes) await c.query('select painel_registrar_migracao($1)', [m.id]);
    await c.query('reset role');
    await c.query('commit');
  } catch (err) {
    await c.query('rollback').catch(() => undefined);
    if (err instanceof ErroApi) throw err;
    registrarErro('nova empresa: preparar banco', err);
    const msg = String((err as { message?: string }).message ?? '').slice(0, 300);
    throw new ErroApi(500, `Banco: ${atual ? `falhou na ${atual}` : 'falhou'}: ${msg}. Nada foi gravado no banco.`);
  } finally {
    await c.end().catch(() => undefined);
  }

  // Confere com o próprio painel_app, pelo mesmo endereço (pooler), antes de guardar.
  const url = urlDoPainelApp(admin, senha);
  const t = cliente(url);
  try {
    await t.connect();
    const r = (await t.query('select current_user as usuario, current_schema() as schema, (select id from painel_empresa) as dono')).rows[0];
    if (r.usuario !== ROLE || r.schema !== SCHEMA || r.dono !== empresa) {
      throw new ErroApi(500, `Banco: o painel_app entrou como ${r.usuario} no schema ${r.schema}. Nada foi guardado no painel.`);
    }
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    throw new ErroApi(502, `Banco preparado, mas o painel_app não conseguiu entrar (${textoErroBanco(e).replace(/^Banco: /, '')}). Clique em Criar de novo: continua de onde parou.`);
  } finally {
    await t.end().catch(() => undefined);
  }
  return { url, aplicadas, ja_feitas: jaFeitas };
}

// ---- 2 a 4. CRM, agente e chave, pela API, no banco novo ----

const ator = (u: Usuario, ref: RefEmpresa): Chave => ({ id: null, nome: u.nome, escopos: ['leitura', 'crm', 'config'], usuario_id: u.id, empresa: ref });

async function montarCrm(u: Usuario, ref: RefEmpresa, modelo: keyof typeof MODELOS_CRM, agente: { nome: string; pausa_min: number }) {
  const m = MODELOS_CRM[modelo];
  const db = bancoDaEmpresa(ref);
  const x = (await db.query(`select (select count(*)::int from crm_etapas) as etapas, (select count(*)::int from crm_topicos) as topicos,
                                    coalesce((select array_agg(chave) from crm_config), '{}') as config`)).rows[0];
  const a = ator(u, ref);
  // CRM já montado (tentativa anterior): não duplica nem mexe no que já está lá.
  if (x.etapas === 0) for (const et of m.etapas) await api.criar(a, 'etapas', et);
  if (x.topicos === 0) for (const t of m.topicos) await api.criar(a, 'topicos', t);
  for (const [k, v] of Object.entries(m.config)) if (!(x.config as string[]).includes(k)) await api.definirConfig(a, k, v);
  // assumir: false até a IA da empresa consultar o dono da conversa (lib/agente.ts).
  await api.definirConfig(a, 'agente', { nome: agente.nome, pausa_min: agente.pausa_min, assumir: false });
  // Chave do n8n: só o hash fica no banco; o valor volta uma vez para a tela.
  const chave = 'pk_' + randomBytes(24).toString('hex');
  await db.query(`insert into api_chaves (nome, hash, escopos) values ('n8n', $1, $2)`,
    [createHash('sha256').update(chave).digest('hex'), ['leitura', 'crm']]);
  return { chave, etapas: m.etapas.length, topicos: m.topicos.length };
}

// ---- Tudo junto ----

export type DadosNovaEmpresa = {
  nome: unknown; apelido: unknown; modelo: unknown; agente: unknown; pausa_min?: unknown;
  admin_nome: unknown; admin_email: unknown; banco: unknown;
};
export type ResultadoNovaEmpresa = {
  id: string; nome: string; dominio: string; codigo: string | null; chave: string; admin: string;
  etapas: number; topicos: number; migracoes: number;
};

const texto = (v: unknown, campo: string, min: number, max: number) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw new ErroApi(400, `${campo}: use de ${min} a ${max} caracteres.`);
  return s;
};

export async function criarEmpresaCompleta(u: Usuario, d: DadosNovaEmpresa): Promise<ResultadoNovaEmpresa> {
  exigirMaster(u);
  // Tudo conferido antes de abrir o banco do cliente.
  const nome = texto(d.nome, 'Nome', 2, 80);
  const id = String(d.apelido ?? '').trim().toLowerCase();
  if (!ID_EMPRESA.test(id)) throw new ErroApi(400, 'Apelido: letras minúsculas, números e hífen (2 a 40), ex.: "ssa". Vira o endereço do painel.');
  if (!ehModelo(d.modelo)) throw new ErroApi(400, 'Escolha o modelo do CRM.');
  const modelo = d.modelo;
  const agente = texto(d.agente, 'Nome do agente de IA', 2, 40);
  const pausa = d.pausa_min === undefined || d.pausa_min === '' ? 30 : Number(d.pausa_min);
  if (!Number.isInteger(pausa) || pausa < 1 || pausa > 1440) throw new ErroApi(400, 'Pausa da IA: de 1 a 1440 minutos.');
  const adminNome = texto(d.admin_nome, 'Nome do admin', 2, 80);
  const adminEmail = String(d.admin_email ?? '').trim().toLowerCase();
  if (!EMAIL.test(adminEmail) || adminEmail.length > 200) throw new ErroApi(400, 'E-mail do admin inválido.');
  const admin = lerUrl(d.banco);
  if (!cifraConfigurada()) throw new ErroApi(503, 'Falta PAINEL_CHAVE_CIFRA no servidor para guardar o banco da empresa.');
  const dominio = `${id}.${sufixoDominio()}`;

  const ja = (await central().query(`
    select (select count(*)::int from empresas where id = $1) as empresa,
           (select empresa_id from empresa_dominios where dominio = $2) as dominio,
           (select master from painel_usuarios where email = $3) as master`, [id, dominio, adminEmail])).rows[0];
  if (ja.empresa) throw new ErroApi(409, `Já existe uma empresa com o apelido "${id}". Escolha outro, ou ajuste a existente no cartão dela.`);
  if (ja.dominio) throw new ErroApi(409, `O endereço ${dominio} já é da empresa "${ja.dominio}".`);
  if (ja.master) throw new ErroApi(409, 'Esse e-mail é da Planee (master); o admin precisa ser alguém da empresa.');

  // 1. Banco do cliente (o que pode falhar por fora: senha, rede, banco de outra empresa).
  const preparo = await prepararBancoDoCliente(admin, id);
  const ref: RefEmpresa = { id, banco_url_cifrado: cifrar(preparo.url), modulos: MODELOS_CRM[modelo].permissoes };

  // 2 a 4. CRM, agente e chave.
  let crm: Awaited<ReturnType<typeof montarCrm>>;
  try { crm = await montarCrm(u, ref, modelo, { nome: agente, pausa_min: pausa }); } catch (e) {
    if (e instanceof ErroApi) throw new ErroApi(e.status, `CRM: ${e.message} O banco ficou pronto; clique em Criar de novo para continuar.`);
    registrarErro('nova empresa: CRM', e);
    throw new ErroApi(500, 'CRM: não foi possível montar o modelo agora. O banco ficou pronto; clique em Criar de novo para continuar.');
  }

  // 5. Banco central: empresa (com o banco cifrado), domínio e admin.
  try {
    await transacao(async (c) => {
      await c.query('insert into empresas (id, nome, modulos, banco_url_cifrado) values ($1,$2,$3,$4)', [id, nome, ref.modulos, ref.banco_url_cifrado]);
      await c.query('insert into empresa_dominios (dominio, empresa_id) values ($1,$2)', [dominio, id]);
      // Nunca a connection string, a senha nem a chave na auditoria.
      await auditar(c, u, id, 'nova_empresa', id, {
        nome, modelo, agente, pausa_min: pausa, dominio, migracoes: preparo.aplicadas + preparo.ja_feitas, continuou: preparo.ja_feitas > 0,
      });
    }, central());
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') throw new ErroApi(409, `A empresa "${id}" ou o endereço ${dominio} acabou de ser cadastrado por outra pessoa.`);
    throw e;
  }
  const criada = await empresaPorId(id);
  if (!criada) throw new ErroApi(500, 'A empresa não apareceu no banco central depois de criada.');
  const codigo = await adicionarPessoa({ ...u, empresa: criada }, { nome: adminNome, email: adminEmail, nivel: 'admin', permissoes: [] });
  return {
    id, nome, dominio, codigo, chave: crm.chave, admin: adminEmail,
    etapas: crm.etapas, topicos: crm.topicos, migracoes: preparo.aplicadas + preparo.ja_feitas,
  };
}

// ---- Conectar número (passo 3) ----
// "painel": a Meta entrega no receptor (override no número) e o receptor repassa à IA (encaminhar_url; vazio = o
//           endereço que recebe hoje na Meta, lido na hora de conectar). As respostas pelo painel avisam a IA por ali.
// "direto": a Meta continua entregando direto na IA (sem override); o painel só avisa a IA das respostas pela
//           Inbox (eco_url). Para a Inbox ver as mensagens, o n8n da IA repassa uma cópia ao receptor.

export type DadosConectar = {
  phone_number_id: unknown; waba_id?: unknown; nome?: unknown; token: unknown; app_secret?: unknown;
  modo: unknown; webhook_ia?: unknown;
};

export async function conectarNumero(u: Usuario, empresa: string, d: DadosConectar): Promise<{ conectando: boolean }> {
  exigirMaster(u);
  const modo = d.modo === 'direto' ? 'direto' : d.modo === 'painel' ? 'painel' : null;
  if (!modo) throw new ErroApi(400, 'Escolha como a IA recebe as mensagens.');
  const webhook = String(d.webhook_ia ?? '').trim();
  if (modo === 'direto' && !webhook) throw new ErroApi(400, 'Webhook da IA: obrigatório quando a IA recebe direto da Meta (é para onde vai o aviso das respostas pelo painel).');
  if (!String(d.token ?? '').trim()) throw new ErroApi(400, 'Token da Meta: obrigatório (é com ele que o painel envia pelo número).');
  const e = (await central().query('select 1 from empresas where id = $1', [empresa])).rowCount;
  if (!e) throw new ErroApi(404, 'Empresa não encontrada.');
  await salvarNumero(u, empresa, {
    phone_number_id: d.phone_number_id, waba_id: d.waba_id, nome: d.nome, token: d.token, app_secret: d.app_secret,
    encaminhar_url: modo === 'painel' ? webhook : '', eco_url: modo === 'direto' ? webhook : '',
  });
  if (modo === 'painel') await pedirNoNumero(u, String(d.phone_number_id).trim(), 'conectar');
  return { conectando: modo === 'painel' };
}
