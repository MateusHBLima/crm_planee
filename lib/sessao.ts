import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { bancoConfigurado, central } from '@/lib/db';
import { COOKIE_ACESSO, usuarioDoToken } from '@/lib/auth/gotrue';
import { COOKIE_EMPRESA, empresaDoDominio, hostDeCabecalhos, type Empresa } from '@/lib/empresa';
import { efetivas, type Nivel, type Permissao } from '@/lib/permissoes';
import type { Chave } from '@/lib/api/auth';

// Quem está usando o painel nesta requisição, em qual empresa e com quais permissões (decisão 26).
// Tudo é conferido no servidor a cada pedido: o navegador nunca decide empresa nem permissão.

export type Usuario = {
  id: string; nome: string; email: string; master: boolean;
  nivel: Nivel;
  empresa: Empresa | null;          // null só para master sem nenhuma empresa cadastrada
  empresaFixa: boolean;             // true quando o endereço acessado é o domínio de uma empresa
  empresas: { id: string; nome: string }[]; // as que a pessoa pode escolher neste endereço
  permissoes: Permissao[];
};

export type Sessao = { usuario: Usuario } | { usuario: null; motivo: 'sessao' | 'empresa' };

type Vinculo = Empresa & { nivel: 'admin' | 'membro'; permissoes_vinculo: string[] };

export const sessaoAtual = cache(async (): Promise<Sessao> => {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso || !bancoConfigurado()) return { usuario: null, motivo: 'sessao' };
  let auth: { id: string; email: string } | null = null;
  try { auth = await usuarioDoToken(acesso); } catch { auth = null; }
  if (!auth) return { usuario: null, motivo: 'sessao' };

  const db = central();
  const p = await db.query(
    `update painel_usuarios set auth_id = coalesce(auth_id, $2), ultimo_acesso = now()
      where lower(email) = lower($1) and ativo and (auth_id is null or auth_id = $2)
      returning id, nome, email, master`,
    [auth.email, auth.id],
  );
  if (!p.rowCount) return { usuario: null, motivo: 'sessao' };
  const pessoa = p.rows[0] as { id: string; nome: string; email: string; master: boolean };

  const vinculos = (await db.query(
    `select e.id, e.nome, e.ativo, e.modulos, e.banco_url_cifrado, v.nivel, v.permissoes as permissoes_vinculo
       from painel_vinculos v join empresas e on e.id = v.empresa_id
      where v.usuario_id = $1 and v.ativo and e.ativo
      order by e.nome`, [pessoa.id],
  )).rows as Vinculo[];

  const fixa = await empresaDoDominio(hostDeCabecalhos(await headers()));
  let empresa: Empresa | null = null;
  let vinculo: Vinculo | undefined;
  let lista: { id: string; nome: string }[];

  if (fixa) {
    // Domínio de uma empresa: só ela, e só para quem é dela (ou master).
    vinculo = vinculos.find((v) => v.id === fixa.id);
    if (!pessoa.master && (!vinculo || !fixa.ativo)) return { usuario: null, motivo: 'empresa' };
    empresa = fixa;
    lista = [{ id: fixa.id, nome: fixa.nome }];
  } else {
    // Endereço geral (adm, localhost, link de teste): a pessoa escolhe entre as empresas dela.
    const candidatas: Empresa[] = pessoa.master
      ? (await db.query('select id, nome, ativo, modulos, banco_url_cifrado from empresas order by ativo desc, nome')).rows
      : vinculos;
    if (!pessoa.master && !candidatas.length) return { usuario: null, motivo: 'empresa' };
    const pedida = (await cookies()).get(COOKIE_EMPRESA)?.value;
    empresa = candidatas.find((e) => e.id === pedida) ?? candidatas[0] ?? null;
    vinculo = empresa ? vinculos.find((v) => v.id === empresa!.id) : undefined;
    lista = candidatas.map((e) => ({ id: e.id, nome: e.nome }));
  }

  const nivel: Nivel = pessoa.master ? 'master' : vinculo!.nivel;
  const permissoes = empresa ? efetivas(nivel, empresa.modulos, vinculo?.permissoes_vinculo ?? []) : [];
  return {
    usuario: {
      ...pessoa, nivel, permissoes, empresaFixa: Boolean(fixa), empresas: lista,
      empresa: empresa ? { id: empresa.id, nome: empresa.nome, ativo: empresa.ativo, modulos: empresa.modulos, banco_url_cifrado: empresa.banco_url_cifrado } : null,
    },
  };
});

export async function usuarioAtual(): Promise<Usuario | null> {
  return (await sessaoAtual()).usuario;
}

export async function exigirUsuario(): Promise<Usuario> {
  const s = await sessaoAtual();
  if (!s.usuario) redirect(`/entrar?motivo=${s.motivo}`);
  return s.usuario;
}

export const pode = (u: Usuario, p: Permissao) => u.permissoes.includes(p);
export const podeArquivar = (u: Usuario) => pode(u, 'crm.arquivar');
export const podeGerirEquipe = (u: Usuario) => Boolean(u.empresa) && (u.nivel === 'master' || u.nivel === 'admin');

// As mesmas regras de escopo das chaves da API, derivadas das permissões da pessoa.
export function atorDe(u: Usuario): Chave {
  const escopos: string[] = [];
  if (pode(u, 'crm.ver')) escopos.push('leitura');
  if (pode(u, 'crm.editar')) escopos.push('crm');
  if (pode(u, 'crm.config')) escopos.push('config');
  return { id: null, nome: u.nome, escopos, usuario_id: u.id, empresa: u.empresa };
}
