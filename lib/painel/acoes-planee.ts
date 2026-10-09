'use server';

import { comUsuario } from './resposta';
import * as av from './avisos';
import * as pl from './planee';
import { rodarVigia } from './vigia';
import { ErroApi } from '@/lib/db';

// Ações (gravar) dos avisos para a Planee, novidades e integrações. As leituras estão em lib/painel/leituras.ts.
// Cada uma confere a sessão; as da Planee conferem também que a pessoa é master.

// Equipe da clínica: "Avisar a Planee" (de uma mensagem da Inbox ou sem mensagem, pela tela Planee).
export async function criarAviso(d: { tipo: string; comentario: string; numero_id?: string | null; wa_id?: string | null; wamid?: string | null; trecho?: string | null }) {
  return comUsuario((u) => av.criarAvisoDaEquipe(u, d), 'avisos');
}

// Planee (master): estado, responsável e resposta (a clínica vê a resposta na tela Planee).
export async function atualizarAviso(id: string, d: { estado?: string; resposta?: string; responsavel?: string }) {
  return comUsuario(async (u) => { await av.atualizarAviso(u, id, d); return av.abrirAviso(u, id); }, 'avisos');
}

export async function salvarNovidade(d: { id?: string | null; tipo: string; titulo: string; texto: string; empresa_id?: string | null; inicio?: string | null; fim?: string | null }) {
  return comUsuario(async (u) => { await pl.salvarNovidade(u, d); return pl.listarNovidades(u); }, 'novidades');
}

export async function arquivarNovidade(id: string, arquivado = true) {
  return comUsuario(async (u) => { await pl.arquivarNovidade(u, id, arquivado); return pl.listarNovidades(u); }, 'novidades');
}

export async function salvarIntegracao(d: { empresa_id: string; sistema: string; rotulo?: string | null; token_valido_ate?: string | null; observacao?: string | null; ativo?: boolean }) {
  return comUsuario(async (u) => { await pl.salvarIntegracao(u, d); return pl.listarIntegracoes(u); }, 'integracoes');
}

// Roda o vigia na hora (o automático roda de 15 em 15 minutos).
export async function verificarAgora() {
  return comUsuario(async (u) => {
    if (!u.master) throw new ErroApi(403, 'Só a Planee (master).');
    return rodarVigia();
  }, 'vigia');
}

// Espelho da agenda (Feegow): roda na hora para a empresa escolhida (o automático roda de 10 em 10 minutos).
export async function sincronizarAgendaAgora() {
  return comUsuario(async (u) => {
    if (!u.master) throw new ErroApi(403, 'Só a Planee (master).');
    if (!u.empresa) throw new ErroApi(400, 'Escolha uma empresa.');
    const { rodarEspelho } = await import('@/lib/agenda/espelho');
    const r = await rodarEspelho(u.empresa.id);
    if (!r.length) throw new ErroApi(400, 'Esta empresa não tem a integração "feegow" ativa (Interno → Integrações).');
    return r[0];
  }, 'agenda');
}
