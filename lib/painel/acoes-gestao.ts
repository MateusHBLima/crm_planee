'use server';

import { cookies, headers } from 'next/headers';
import { ErroApi, registrarErro } from '@/lib/db';
import { COOKIE_EMPRESA, empresaPorId } from '@/lib/empresa';
import { esquecerSessoes, usuarioAtual, type Usuario } from '@/lib/sessao';
import * as g from './gestao';
import * as n from './numeros';
import type { Resposta } from './acoes';

// Ações das telas Empresas e Equipe. Cada uma confere a sessão e o nível de novo no servidor.

async function comUsuario<T>(fn: (u: Usuario) => Promise<T>): Promise<Resposta<T>> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sua sessão terminou. Entre de novo.', sair: true };
  try {
    return { ok: true, dados: await fn(u) };
  } catch (e) {
    if (e instanceof ErroApi) return { ok: false, erro: e.message };
    registrarErro('gestao', e);
    return { ok: false, erro: 'Não foi possível concluir agora. Tente de novo em instantes.' };
  } finally {
    // Empresa, pessoa, vínculo ou permissão pode ter mudado: a próxima tela monta a sessão de novo.
    esquecerSessoes();
  }
}

// id vazio = sair da empresa (só o master tem a visão da Planee, sem empresa).
export async function trocarEmpresa(id: string) {
  return comUsuario(async (u) => {
    if (u.empresaFixa) throw new ErroApi(400, 'Neste endereço a empresa é fixa.');
    const jar = await cookies();
    if (!id) {
      if (!u.master) throw new ErroApi(400, 'Escolha uma empresa.');
      jar.delete(COOKIE_EMPRESA);
      return true;
    }
    if (!u.empresas.some((e) => e.id === id)) throw new ErroApi(403, 'Você não tem acesso a essa empresa.');
    jar.set(COOKIE_EMPRESA, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 90 });
    return true;
  });
}

export async function carregarEmpresas() { return comUsuario((u) => g.listarEmpresas(u)); }
export async function criarEmpresa(dados: { id: string; nome: string; modulos: string[] }) {
  return comUsuario(async (u) => { await g.criarEmpresa(u, dados); return g.listarEmpresas(u); });
}
export async function atualizarEmpresa(id: string, dados: { nome?: string; ativo?: boolean; modulos?: string[] }) {
  return comUsuario(async (u) => { await g.atualizarEmpresa(u, id, dados); return g.listarEmpresas(u); });
}
export async function definirBancoEmpresa(id: string, url: string) {
  return comUsuario(async (u) => { await g.definirBancoEmpresa(u, id, url); return g.listarEmpresas(u); });
}
export async function adicionarDominio(empresa: string, dominio: string) {
  return comUsuario(async (u) => { await g.adicionarDominio(u, empresa, dominio); return g.listarEmpresas(u); });
}
export async function removerDominio(dominio: string) {
  return comUsuario(async (u) => { await g.removerDominio(u, dominio); return g.listarEmpresas(u); });
}
// O master cadastra o primeiro admin de uma empresa direto na tela Empresas.
export async function adicionarAdmin(empresa: string, nome: string, email: string) {
  return comUsuario(async (u) => {
    if (u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee (master) faz isso.');
    const e = await empresaPorId(empresa);
    if (!e) throw new ErroApi(404, 'Empresa não encontrada.');
    const codigo = await g.adicionarPessoa({ ...u, empresa: e }, { nome, email, nivel: 'admin', permissoes: [] });
    return { empresas: await g.listarEmpresas(u), codigo };
  });
}

// Números de WhatsApp da empresa (master). Conectar e puxar o histórico só marcam o pedido: o receptor executa.
export async function salvarNumero(empresa: string, dados: { phone_number_id: string; waba_id?: string; nome?: string; encaminhar_url?: string; token?: string; app_secret?: string }) {
  return comUsuario(async (u) => { await n.salvarNumero(u, empresa, dados); return g.listarEmpresas(u); });
}
export async function pedirNoNumero(phoneNumberId: string, pedido: 'conectar' | 'historico' | 'ativar' | 'desativar') {
  return comUsuario(async (u) => { await n.pedirNoNumero(u, phoneNumberId, pedido); return g.listarEmpresas(u); });
}

export async function carregarEquipe() { return comUsuario((u) => g.listarEquipe(u)); }
export async function adicionarPessoa(dados: { nome: string; email: string; nivel: string; permissoes: string[] }) {
  return comUsuario(async (u) => { const codigo = await g.adicionarPessoa(u, dados); return { pessoas: await g.listarEquipe(u), codigo }; });
}
export async function novoConvite(id: string) {
  return comUsuario((u) => g.novoConvite(u, id));
}
export async function atualizarPessoa(id: string, dados: { nivel?: string; permissoes?: string[]; ativo?: boolean }) {
  return comUsuario(async (u) => { await g.atualizarPessoa(u, id, dados); return g.listarEquipe(u); });
}

// Link de convite de uso único (09/10). O link aparece só na resposta de gerarLink: no banco fica o hash.
export async function gerarLinkConvite(permissoes: string[]) {
  return comUsuario(async (u) => {
    const h = await headers();
    const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim() || null;
    return g.gerarLinkConvite(u, { permissoes }, host);
  });
}
export async function cancelarLinkConvite(id: string) {
  return comUsuario((u) => g.cancelarLinkConvite(u, id));
}
