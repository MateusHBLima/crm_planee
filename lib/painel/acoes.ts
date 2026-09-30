'use server';

import { ErroApi } from '@/lib/db';
import { usuarioAtual } from '@/lib/sessao';
import * as crm from './crm';

// Ações chamadas pelas telas. Cada uma confere a sessão de novo (nunca confia no navegador)
// e devolve o quadro atualizado, para a tela não precisar de outra ida ao servidor.

export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: string; sair?: boolean };

async function comUsuario<T>(fn: (u: NonNullable<Awaited<ReturnType<typeof usuarioAtual>>>) => Promise<T>): Promise<Resposta<T>> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sua sessão terminou. Entre de novo.', sair: true };
  try {
    return { ok: true, dados: await fn(u) };
  } catch (e) {
    if (e instanceof ErroApi) return { ok: false, erro: e.message };
    console.error(e);
    return { ok: false, erro: 'Não foi possível concluir agora. Tente de novo em instantes.' };
  }
}

export async function carregarQuadro() {
  return comUsuario((u) => crm.lerQuadro(u));
}

export async function carregarDetalhe(id: string) {
  return comUsuario((u) => crm.lerDetalhe(u, id));
}

export async function assumirAtendimento(id: string) {
  return comUsuario(async (u) => { await crm.assumir(u, id); return crm.lerQuadro(u); });
}

export async function moverAtendimento(id: string, etapa: crm.Etapa) {
  return comUsuario(async (u) => { await crm.mover(u, id, etapa); return crm.lerQuadro(u); });
}

export async function mudarAssunto(id: string, topico: string) {
  return comUsuario(async (u) => { await crm.mudarAssunto(u, id, topico); return crm.lerQuadro(u); });
}

export async function anotarAtendimento(id: string, texto: string) {
  return comUsuario(async (u) => { await crm.anotar(u, id, texto); return crm.lerDetalhe(u, id); });
}

export async function arquivarAtendimento(id: string) {
  return comUsuario(async (u) => { await crm.arquivarAtendimento(u, id); return crm.lerQuadro(u); });
}

export async function carregarComercial() {
  return comUsuario((u) => crm.lerComercial(u));
}

export async function carregarContatos() {
  return comUsuario((u) => crm.lerContatos(u));
}

export async function carregarAtendimentosDoContato(id: string) {
  return comUsuario((u) => crm.lerAtendimentosDoContato(u, id));
}
