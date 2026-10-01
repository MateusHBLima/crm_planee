'use server';

import { ErroApi, registrarErro } from '@/lib/db';
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
    registrarErro('tela', e);
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

export async function moverAtendimento(id: string, etapa: crm.Etapa, de?: crm.Etapa) {
  return comUsuario(async (u) => { await crm.mover(u, id, etapa, de); return crm.lerQuadro(u); });
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

// ---- Criar e editar pelo painel ----

export async function criarAtendimento(dados: { telefone: string; nome: string; topico_id: string; resumo: string }) {
  return comUsuario(async (u) => { await crm.novoAtendimento(u, dados); return crm.lerQuadro(u); });
}

export async function salvarContato(id: string | null, dados: { nome: string; telefone: string; documento: string }) {
  return comUsuario(async (u) => { const novo = await crm.salvarContato(u, id, dados); return { id: novo, lista: await crm.lerContatos(u) }; });
}

export async function carregarNotasDoContato(id: string) {
  return comUsuario((u) => crm.notasDoContato(u, id));
}

export async function anotarNoContato(id: string, texto: string) {
  return comUsuario(async (u) => { await crm.anotarContato(u, id, texto); return crm.notasDoContato(u, id); });
}

export async function criarOportunidade(dados: { telefone: string; nome: string; interesse: string; valor: string; etapa_id: string }) {
  return comUsuario(async (u) => { await crm.novaOportunidade(u, dados); return crm.lerComercial(u); });
}

export async function editarOportunidade(id: string, dados: { interesse?: string; valor?: string; etapa_id?: string }) {
  return comUsuario(async (u) => { await crm.editarOportunidade(u, id, dados); return crm.lerComercial(u); });
}

export async function arquivarOportunidade(id: string) {
  return comUsuario(async (u) => { await crm.arquivarOportunidade(u, id); return crm.lerComercial(u); });
}

// ---- Configuração do CRM ----

export async function carregarConfigCrm() {
  return comUsuario((u) => crm.lerConfigCrm(u));
}

export async function salvarAssunto(id: string | null, dados: { nome: string; icone: string; ordem: string; palavras: string }) {
  return comUsuario(async (u) => { await crm.salvarTopico(u, id, dados); return crm.lerConfigCrm(u); });
}

export async function salvarEtapaDoFunil(id: string | null, dados: { nome: string; tipo: string; ordem: string; gatilho: string }) {
  return comUsuario(async (u) => { await crm.salvarEtapaFunil(u, id, dados); return crm.lerConfigCrm(u); });
}

export async function arquivarDaConfig(recurso: 'topicos' | 'etapas', id: string) {
  return comUsuario(async (u) => {
    if (recurso !== 'topicos' && recurso !== 'etapas') throw new ErroApi(400, 'Item inválido.');
    await crm.arquivarItemConfig(u, recurso, id);
    return crm.lerConfigCrm(u);
  });
}

export async function salvarNomesDasEtapas(nomes: Record<string, string>) {
  return comUsuario(async (u) => { await crm.salvarNomesEtapas(u, nomes); return crm.lerConfigCrm(u); });
}
