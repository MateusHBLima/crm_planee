// Leituras chamadas pelas telas no navegador: GET /api/painel/ler/<recurso> (ver lib/painel/leituras.ts).
// Mesmos nomes e o mesmo envelope das antigas ações do servidor, para as telas não mudarem.
import type { Resposta } from './resposta';
import type * as crm from './crm';
import type * as sv from './servicos';
import type * as inbox from './inbox';
import type * as av from './avisos';
import type * as pl from './planee';

type R<F extends (...a: never[]) => Promise<unknown>> = Promise<Resposta<Awaited<ReturnType<F>>>>;

async function ler<T>(recurso: string, params: Record<string, string | null | undefined> = {}): Promise<Resposta<T>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, v);
  try {
    const r = await fetch(`/api/painel/ler/${recurso}${q.size ? `?${q}` : ''}`, { cache: 'no-store', credentials: 'same-origin' });
    // Sem sessão, o middleware manda para /entrar: a tela trata como "sessão terminou".
    if (r.redirected && new URL(r.url).pathname.startsWith('/entrar')) return { ok: false, erro: 'Sua sessão terminou. Entre de novo.', sair: true };
    const j = (await r.json().catch(() => null)) as Resposta<T> | null;
    if (j && typeof j === 'object' && 'ok' in j) return j;
    return { ok: false, erro: 'Não foi possível carregar agora. Tente de novo em instantes.' };
  } catch {
    return { ok: false, erro: 'Sem conexão com o painel agora. Tentando de novo.' };
  }
}

export const carregarQuadro = (): R<typeof crm.lerQuadro> => ler('quadro');
export const carregarDetalhe = (id: string): R<typeof crm.lerDetalhe> => ler('detalhe', { id });
export const carregarComercial = (): R<typeof crm.lerComercial> => ler('comercial');
export const carregarContatos = (): R<typeof crm.lerContatos> => ler('contatos');
export const carregarAtendimentosDoContato = (id: string): R<typeof crm.lerAtendimentosDoContato> => ler('atendimentos_contato', { id });
export const carregarNotasDoContato = (id: string): R<typeof crm.notasDoContato> => ler('notas_contato', { id });
export const carregarHistorico = (id: string): R<typeof sv.historicoContato> => ler('historico', { id });
export const carregarServico = (id: string): R<typeof sv.detalheServico> => ler('servico', { id });
export const carregarConversas = (busca?: string): R<typeof inbox.listarConversas> => ler('conversas', { busca });
export const abrirConversa = (numeroId: string, waId: string, antesDeId?: string | null): R<typeof inbox.lerConversa> =>
  ler('conversa', { numero: numeroId, wa: waId, antes: antesDeId ?? null });

export const carregarPlaneeDaEmpresa = (): Promise<Resposta<{ avisos: av.MeuAviso[]; novidades: pl.Novidade[] }>> => ler('planee_empresa');
export const carregarFaixa = (): R<typeof pl.faixaDaEmpresa> => ler('faixa');
export const carregarAvisos = (estado?: string | null, empresa?: string | null): R<typeof av.listarAvisos> => ler('avisos', { estado, empresa });
export const carregarAviso = (id: string): R<typeof av.abrirAviso> => ler('aviso', { id });
export const carregarSaude = (): R<typeof pl.saudeClientes> => ler('saude');
export const carregarSaudeEmpresa = (id: string): R<typeof pl.saudeEmpresa> => ler('saude_empresa', { id });
export const carregarNovidades = (): R<typeof pl.listarNovidades> => ler('novidades');
export const carregarIntegracoes = (): R<typeof pl.listarIntegracoes> => ler('integracoes');
