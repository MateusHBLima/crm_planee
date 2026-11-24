'use server';

import { comUsuario } from './resposta';
import * as ap from './agenda-propria';

// Ações da agenda própria (23/11). Cada uma confere a sessão, a empresa e a permissão (agenda.editar ou agenda.config).
export async function marcarNaAgenda(dados: Record<string, unknown>) {
  return comUsuario((u) => ap.marcar(u, dados), 'agenda');
}
export async function alterarNaAgenda(id: string, dados: Record<string, unknown>) {
  return comUsuario((u) => ap.alterar(u, id, dados), 'agenda');
}
export async function horariosDaAgenda(tipo: string, profissional: string | null, de: string, ate: string) {
  return comUsuario((u) => ap.horarios(u, tipo, profissional, de, ate), 'agenda');
}
export async function salvarProfissional(dados: Record<string, unknown>) {
  return comUsuario((u) => ap.salvarProfissional(u, dados), 'agenda');
}
export async function salvarTipo(dados: Record<string, unknown>) {
  return comUsuario((u) => ap.salvarTipo(u, dados), 'agenda');
}
export async function arquivarDaAgenda(qual: string, id: string) {
  return comUsuario((u) => ap.arquivar(u, qual, id), 'agenda');
}
export async function salvarGrade(profissional: string, janelas: unknown) {
  return comUsuario((u) => ap.salvarGrade(u, profissional, janelas), 'agenda');
}
export async function salvarBloqueio(dados: Record<string, unknown>) {
  return comUsuario((u) => ap.salvarBloqueio(u, dados), 'agenda');
}
export async function salvarConfigAgenda(dados: Record<string, unknown>) {
  return comUsuario((u) => ap.salvarConfig(u, dados), 'agenda');
}
