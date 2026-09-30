import 'server-only';
import type { PoolClient } from 'pg';
import { central, ErroApi, transacao } from '@/lib/db';
import { cifrar, cifraConfigurada } from '@/lib/cifra';
import { limparPermissoes, type Nivel, type Permissao } from '@/lib/permissoes';
import type { Usuario } from '@/lib/sessao';

// Cadastros do banco central (decisão 26): empresas, domínios, pessoas e permissões.
// Master: tudo. Admin: só a equipe da própria empresa, e só com permissões que a empresa tem.

const ID_EMPRESA = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DOMINIO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Domínio do próprio painel da Planee: tem rota fixa na stack, não pode ser de empresa.
const hostAdm = () => (process.env.PAINEL_HOST_ADM || 'adm.planeelabia.com').toLowerCase();

function exigirMaster(u: Usuario) {
  if (u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee (master) faz isso.');
}

function exigirGestorDaEmpresa(u: Usuario): string {
  if (!u.empresa) throw new ErroApi(400, 'Escolha uma empresa primeiro.');
  if (u.nivel !== 'master' && u.nivel !== 'admin') throw new ErroApi(403, 'Só o admin da empresa ou a Planee cuidam da equipe.');
  return u.empresa.id;
}

async function auditar(c: PoolClient, u: Usuario, empresa: string | null, acao: string, alvo: string | null, detalhe: unknown) {
  await c.query(
    'insert into central_auditoria (usuario_id, empresa_id, acao, alvo, detalhe) values ($1,$2,$3,$4,$5)',
    [u.id, empresa, acao, alvo, detalhe === undefined ? null : JSON.stringify(detalhe)],
  );
}

const nomeValido = (n: unknown, campo: string) => {
  const s = String(n ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 80) throw new ErroApi(400, `${campo}: use de 2 a 80 caracteres.`);
  return s;
};

// ---- Empresas (master) ----

export type LinhaEmpresa = {
  id: string; nome: string; ativo: boolean; modulos: Permissao[]; banco_proprio: boolean;
  dominios: string[]; pessoas: number; admins: string[];
};

export async function listarEmpresas(u: Usuario): Promise<LinhaEmpresa[]> {
  exigirMaster(u);
  const r = await central().query(`
    select e.id, e.nome, e.ativo, e.modulos, e.banco_url_cifrado is not null as banco_proprio,
           coalesce((select array_agg(d.dominio order by d.dominio) from empresa_dominios d where d.empresa_id = e.id), '{}') as dominios,
           (select count(*)::int from painel_vinculos v join painel_usuarios p on p.id = v.usuario_id
             where v.empresa_id = e.id and v.ativo and p.ativo) as pessoas,
           coalesce((select array_agg(p.email order by p.email) from painel_vinculos v join painel_usuarios p on p.id = v.usuario_id
             where v.empresa_id = e.id and v.ativo and p.ativo and v.nivel = 'admin'), '{}') as admins
      from empresas e order by e.ativo desc, e.nome`);
  return r.rows.map((x) => ({ ...x, modulos: limparPermissoes(x.modulos) }));
}

export async function criarEmpresa(u: Usuario, dados: { id: unknown; nome: unknown; modulos: unknown }) {
  exigirMaster(u);
  const id = String(dados.id ?? '').trim().toLowerCase();
  if (!ID_EMPRESA.test(id)) throw new ErroApi(400, 'Identificador: letras minúsculas, números e hífen (2 a 40), ex.: "clinica-amilton".');
  const nome = nomeValido(dados.nome, 'Nome');
  const modulos = limparPermissoes(dados.modulos);
  try {
    await transacao(async (c) => {
      await c.query('insert into empresas (id, nome, modulos) values ($1,$2,$3)', [id, nome, modulos]);
      await auditar(c, u, id, 'criar_empresa', id, { nome, modulos });
    }, central());
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ErroApi(409, `Já existe uma empresa com o identificador "${id}".`);
    throw e;
  }
}

export async function atualizarEmpresa(u: Usuario, id: string, dados: { nome?: unknown; ativo?: unknown; modulos?: unknown }) {
  exigirMaster(u);
  const sets: string[] = []; const vals: unknown[] = [id]; const det: Record<string, unknown> = {};
  if (dados.nome !== undefined) { const n = nomeValido(dados.nome, 'Nome'); vals.push(n); sets.push(`nome = $${vals.length}`); det.nome = n; }
  if (dados.ativo !== undefined) { vals.push(Boolean(dados.ativo)); sets.push(`ativo = $${vals.length}`); det.ativo = Boolean(dados.ativo); }
  if (dados.modulos !== undefined) { const m = limparPermissoes(dados.modulos); vals.push(m); sets.push(`modulos = $${vals.length}`); det.modulos = m; }
  if (!sets.length) return;
  await transacao(async (c) => {
    const r = await c.query(`update empresas set ${sets.join(', ')}, atualizado_em = now() where id = $1`, vals);
    if (!r.rowCount) throw new ErroApi(404, 'Empresa não encontrada.');
    await auditar(c, u, id, 'atualizar_empresa', id, det);
  }, central());
}

// Endereço do banco de dados da empresa (connection string). Vazio = volta para o banco padrão do deploy.
export async function definirBancoEmpresa(u: Usuario, id: string, url: unknown) {
  exigirMaster(u);
  const texto = String(url ?? '').trim();
  if (texto && !/^postgres(ql)?:\/\/\S+$/.test(texto)) throw new ErroApi(400, 'Use a connection string do Postgres (postgresql://...).');
  if (texto && !cifraConfigurada()) throw new ErroApi(503, 'Falta PAINEL_CHAVE_CIFRA no servidor para guardar o banco da empresa.');
  await transacao(async (c) => {
    const r = await c.query('update empresas set banco_url_cifrado = $2, atualizado_em = now() where id = $1', [id, texto ? cifrar(texto) : null]);
    if (!r.rowCount) throw new ErroApi(404, 'Empresa não encontrada.');
    await auditar(c, u, id, texto ? 'definir_banco' : 'banco_padrao', id, null); // o endereço nunca vai para a auditoria
  }, central());
}

export async function adicionarDominio(u: Usuario, empresa: string, dominio: unknown) {
  exigirMaster(u);
  const d = String(dominio ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!DOMINIO.test(d) || d.length > 253) throw new ErroApi(400, 'Domínio inválido. Ex.: painel.clinica.com.br');
  if (d === hostAdm()) throw new ErroApi(400, 'Esse é o endereço do painel da Planee; não pode ser de uma empresa.');
  try {
    await transacao(async (c) => {
      await c.query('insert into empresa_dominios (dominio, empresa_id) values ($1,$2)', [d, empresa]);
      await auditar(c, u, empresa, 'adicionar_dominio', d, null);
    }, central());
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') throw new ErroApi(409, `O domínio ${d} já está cadastrado.`);
    if (code === '23503') throw new ErroApi(404, 'Empresa não encontrada.');
    throw e;
  }
}

export async function removerDominio(u: Usuario, dominio: string) {
  exigirMaster(u);
  await transacao(async (c) => {
    const r = await c.query('delete from empresa_dominios where dominio = $1 returning empresa_id', [dominio]);
    if (!r.rowCount) throw new ErroApi(404, 'Domínio não encontrado.');
    await auditar(c, u, r.rows[0].empresa_id, 'remover_dominio', dominio, null);
  }, central());
}

// ---- Equipe da empresa escolhida (admin e master) ----

export type Pessoa = {
  id: string; nome: string; email: string; nivel: 'admin' | 'membro'; permissoes: Permissao[];
  ativo: boolean; ja_entrou: boolean;
};

export async function listarEquipe(u: Usuario): Promise<Pessoa[]> {
  const empresa = exigirGestorDaEmpresa(u);
  const r = await central().query(`
    select p.id, p.nome, p.email, v.nivel, v.permissoes, (v.ativo and p.ativo) as ativo, p.auth_id is not null as ja_entrou
      from painel_vinculos v join painel_usuarios p on p.id = v.usuario_id
     where v.empresa_id = $1
     order by (v.ativo and p.ativo) desc, v.nivel, p.nome`, [empresa]);
  return r.rows.map((x) => ({ ...x, permissoes: limparPermissoes(x.permissoes) }));
}

function nivelPermitido(u: Usuario, nivel: unknown): 'admin' | 'membro' {
  if (nivel !== 'admin' && nivel !== 'membro') throw new ErroApi(400, 'Nível inválido.');
  if (nivel === 'admin' && u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee cadastra admins.');
  return nivel;
}

// Admin só distribui o que a empresa tem; o que vier a mais é recusado (não é cortado em silêncio).
function permissoesPermitidas(u: Usuario, lista: unknown): Permissao[] {
  const pedidas = limparPermissoes(lista);
  const daEmpresa = new Set(u.empresa?.modulos ?? []);
  const fora = pedidas.filter((p) => !daEmpresa.has(p));
  if (fora.length) throw new ErroApi(403, `A empresa não tem estas permissões liberadas: ${fora.join(', ')}.`);
  return pedidas;
}

export async function adicionarPessoa(u: Usuario, dados: { nome: unknown; email: unknown; nivel: unknown; permissoes: unknown }) {
  const empresa = exigirGestorDaEmpresa(u);
  const nome = nomeValido(dados.nome, 'Nome');
  const email = String(dados.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) throw new ErroApi(400, 'E-mail inválido.');
  const nivel = nivelPermitido(u, dados.nivel);
  const permissoes = nivel === 'admin' ? [] : permissoesPermitidas(u, dados.permissoes);
  await transacao(async (c) => {
    const p = await c.query(
      `insert into painel_usuarios (email, nome) values ($1, $2)
       on conflict (email) do update set nome = painel_usuarios.nome
       returning id, master`, [email, nome]);
    const { id, master } = p.rows[0];
    if (master) throw new ErroApi(409, 'Esse e-mail é da Planee (master) e já vê todas as empresas.');
    const v = await c.query(
      `insert into painel_vinculos (usuario_id, empresa_id, nivel, permissoes) values ($1,$2,$3,$4)
       on conflict (usuario_id, empresa_id) do nothing`, [id, empresa, nivel, permissoes]);
    if (!v.rowCount) throw new ErroApi(409, 'Essa pessoa já está na equipe desta empresa.');
    await auditar(c, u, empresa, 'adicionar_pessoa', email, { nivel, permissoes });
  }, central());
}

export async function atualizarPessoa(u: Usuario, usuarioId: string, dados: { nivel?: unknown; permissoes?: unknown; ativo?: unknown }) {
  const empresa = exigirGestorDaEmpresa(u);
  if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) throw new ErroApi(400, 'Pessoa inválida.');
  if (usuarioId === u.id) throw new ErroApi(400, 'Você não pode mudar o próprio acesso. Peça a outro admin ou à Planee.');
  await transacao(async (c) => {
    const atual = await c.query('select nivel from painel_vinculos where usuario_id = $1 and empresa_id = $2 for update', [usuarioId, empresa]);
    if (!atual.rowCount) throw new ErroApi(404, 'Essa pessoa não é da equipe desta empresa.');
    const nivelAtual = atual.rows[0].nivel as 'admin' | 'membro';
    if (nivelAtual === 'admin' && u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee muda um admin.');
    const sets: string[] = []; const vals: unknown[] = [usuarioId, empresa]; const det: Record<string, unknown> = {};
    let nivel: Nivel = nivelAtual;
    if (dados.nivel !== undefined) { nivel = nivelPermitido(u, dados.nivel); vals.push(nivel); sets.push(`nivel = $${vals.length}`); det.nivel = nivel; }
    if (dados.permissoes !== undefined) {
      const perms = nivel === 'admin' ? [] : permissoesPermitidas(u, dados.permissoes);
      vals.push(perms); sets.push(`permissoes = $${vals.length}`); det.permissoes = perms;
    }
    if (dados.ativo !== undefined) { vals.push(Boolean(dados.ativo)); sets.push(`ativo = $${vals.length}`); det.ativo = Boolean(dados.ativo); }
    if (!sets.length) return;
    await c.query(`update painel_vinculos set ${sets.join(', ')}, atualizado_em = now() where usuario_id = $1 and empresa_id = $2`, vals);
    await auditar(c, u, empresa, 'atualizar_pessoa', usuarioId, det);
  }, central());
}
