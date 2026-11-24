import 'server-only';
import { empresaDoBancoPadrao, ErroApi } from '@/lib/db';
import { empresaPorId } from '@/lib/empresa';
import type { Chave } from './auth';

// A agenda própria (23/11) só existe na empresa que a tem ligada (agenda.ver em empresas.modulos, tela Empresas):
// rotas /api/v1/agenda, recursos agenda_* e o catálogo. Pelo endereço geral do painel (sem domínio de empresa) vale a
// empresa do banco padrão.
export async function agendaLigada(empresa: { modulos?: string[] } | null | undefined): Promise<boolean> {
  let m = empresa?.modulos;
  if (!m) { const id = empresaDoBancoPadrao(); m = id ? (await empresaPorId(id).catch(() => null))?.modulos : undefined; }
  return !m || m.includes('agenda.ver');
}
export async function exigirLigada(chave: Chave) {
  if (!(await agendaLigada(chave.empresa as { modulos?: string[] } | null))) throw new ErroApi(404, 'A agenda própria não está ligada nesta empresa.');
}
