import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { bancoConfigurado, central } from '@/lib/db';
import { COOKIE_ACESSO, mfaExigido, nivelDaSessao, usuarioDoToken } from '@/lib/auth/gotrue';
import { COOKIE_EMPRESA, hostDeCabecalhos, type Empresa } from '@/lib/empresa';
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

export type Sessao = { usuario: Usuario } | { usuario: null; motivo: 'sessao' | 'empresa' | 'mfa' };

type Vinculo = Empresa & { nivel: 'admin' | 'membro'; permissoes_vinculo: string[] };

// Telas e ações conferem tudo no banco central a cada pedido (desativar alguém vale na hora).
export const sessaoAtual = cache(async (): Promise<Sessao> => {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso || !bancoConfigurado()) return { usuario: null, motivo: 'sessao' };
  return montarSessao(acesso);
});

// Só as leituras automáticas (GET /api/painel/ler: quadro a cada 15 s, Inbox a cada 10 s) reaproveitam a sessão
// já montada por alguns segundos (mesmo token, mesmo endereço, mesma empresa escolhida). O banco central fica em
// outra região e cada leitura pagava essa ida. Telas e ações continuam conferindo na hora; mudança na tela de
// gestão limpa a memória (esquecerSessoes). Pior caso: alguém desativado ainda lê por até SESSAO_MS.
const SESSAO_MS = 15_000;
// No globalThis: o Next empacota as rotas e as ações em pacotes separados, cada um com a sua cópia deste módulo.
// Sem isso, esquecerSessoes() numa ação (ex.: salvar o banco da empresa) não limpava a memória das leituras (09/10).
const g = globalThis as unknown as { __painelSessoes?: Map<string, { s: Sessao; ate: number }> };
const memoria = (g.__painelSessoes ??= new Map<string, { s: Sessao; ate: number }>());
export function esquecerSessoes() { memoria.clear(); }

export async function usuarioParaLeitura(): Promise<Usuario | null> {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso || !bancoConfigurado()) return null;
  const chave = `${acesso}|${hostDeCabecalhos(await headers())}|${(await cookies()).get(COOKIE_EMPRESA)?.value ?? ''}`;
  const agora = Date.now();
  const lembrada = memoria.get(chave);
  if (lembrada && lembrada.ate > agora) return lembrada.s.usuario;
  const s = await sessaoAtual();
  if (s.usuario) {
    if (memoria.size > 500) for (const [k, v] of memoria) if (v.ate <= agora) memoria.delete(k);
    if (memoria.size <= 1000) memoria.set(chave, { s, ate: agora + SESSAO_MS });
  }
  return s.usuario;
}

async function montarSessao(acesso: string): Promise<Sessao> {
  let auth: { id: string; email: string } | null = null;
  try { auth = await usuarioDoToken(acesso); } catch { auth = null; }
  if (!auth) return { usuario: null, motivo: 'sessao' };

  // Uma ida só ao banco central: a pessoa, os vínculos dela, a lista de empresas (se for master) e a empresa
  // dona do endereço acessado. Cada ida custava ~0,1 s (o banco fica em outra região).
  const host = hostDeCabecalhos(await headers());
  const r = await central().query(
    `with p as (
       update painel_usuarios set auth_id = coalesce(auth_id, $2), ultimo_acesso = now()
        where lower(email) = lower($1) and ativo and (auth_id is null or auth_id = $2)
        returning id, nome, email, master),
     v as (
       select e.id, e.nome, e.ativo, e.modulos, e.banco_url_cifrado, v.nivel, v.permissoes as permissoes_vinculo
         from painel_vinculos v join empresas e on e.id = v.empresa_id join p on p.id = v.usuario_id
        where v.ativo and e.ativo),
     t as (
       select e.id, e.nome, e.ativo, e.modulos, e.banco_url_cifrado from empresas e where (select master from p)),
     d as (
       select e.id, e.nome, e.ativo, e.modulos, e.banco_url_cifrado
         from empresa_dominios d join empresas e on e.id = d.empresa_id where d.dominio = $3)
     select (select row_to_json(p) from p) as pessoa,
            coalesce((select json_agg(v order by v.nome) from v), '[]'::json) as vinculos,
            coalesce((select json_agg(t order by t.ativo desc, t.nome) from t), '[]'::json) as todas,
            (select row_to_json(d) from d limit 1) as fixa`,
    [auth.email, auth.id, host],
  );
  const linha = r.rows[0] as { pessoa: { id: string; nome: string; email: string; master: boolean } | null; vinculos: Vinculo[]; todas: Empresa[]; fixa: Empresa | null };
  if (!linha?.pessoa) return { usuario: null, motivo: 'sessao' };
  const pessoa = linha.pessoa;
  // O master (todas as clínicas) só passa com o segundo fator: senha sozinha não abre nenhuma tela.
  if (pessoa.master && mfaExigido() && nivelDaSessao(acesso) !== 'aal2') return { usuario: null, motivo: 'mfa' };
  const vinculos = linha.vinculos;
  const fixa = linha.fixa;
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
    const candidatas: Empresa[] = pessoa.master ? linha.todas : vinculos;
    if (!pessoa.master && !candidatas.length) return { usuario: null, motivo: 'empresa' };
    const pedida = (await cookies()).get(COOKIE_EMPRESA)?.value;
    // O master entra na visão da Planee (sem empresa) até escolher uma no seletor.
    // Quem não é master cai na primeira empresa dele: sem empresa não há tela para ele.
    empresa = candidatas.find((e) => e.id === pedida) ?? (pessoa.master ? null : candidatas[0]) ?? null;
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
}

export async function usuarioAtual(): Promise<Usuario | null> {
  return (await sessaoAtual()).usuario;
}

export async function exigirUsuario(): Promise<Usuario> {
  const s = await sessaoAtual();
  if (!s.usuario) redirect(s.motivo === 'mfa' ? '/entrar/verificacao' : `/entrar?motivo=${s.motivo}`);
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
