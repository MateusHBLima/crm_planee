import 'server-only';

// Cliente da API da Feegow (só leitura) para o espelho da agenda. O token NÃO fica no banco: vem da variável
// FEEGOW_TOKEN_<EMPRESA> da stack do painel (ex.: FEEGOW_TOKEN_NEURO_ESSENTIA), que só o Mateus preenche no
// Portainer. FEEGOW_API_URL troca o endereço (testes usam uma Feegow falsa).
// Documentação: docs.feegow.com (cópia no projeto). Datas da API: DD-MM-YYYY.

export const baseFeegow = () => (process.env.FEEGOW_API_URL || 'https://api.feegow.com/v1/api').replace(/\/+$/, '');
export const nomeVariavelToken = (empresaId: string) => `FEEGOW_TOKEN_${empresaId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
export const tokenFeegow = (empresaId: string): string | null => process.env[nomeVariavelToken(empresaId)]?.trim() || null;

export class ErroFeegow extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

export type AgendamentoFeegow = {
  agendamento_id: number | string; data: string; horario: string; paciente_id: number | string | null;
  procedimento_id: number | string | null; status_id: number | string | null; local_id: number | string | null;
  profissional_id: number | string | null; agendado_por?: string | null; notas?: string | null; agendado_em?: string | null;
  canal_id?: number | string | null; unidade_id?: number | string | null; nome_fantasia?: string | null; encaixe?: boolean | null;
  telemedicina?: boolean | null; retorno?: boolean | null; primeiro_agendamento?: number | null; valor_total_agendamento?: string | null;
  especialidade_id?: number | string | null; convenio_id?: number | string | null;
};

export type Contador = { chamadas: number };

export function clienteFeegow(token: string, contador: Contador, tempoMs = 20_000) {
  async function get<T>(caminho: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    contador.chamadas++;
    const r = await fetch(`${baseFeegow()}/${caminho}${q.size ? `?${q}` : ''}`, {
      headers: { 'x-access-token': token, accept: 'application/json' }, signal: AbortSignal.timeout(tempoMs),
    });
    const corpo = await r.json().catch(() => null) as { success?: boolean; content?: unknown } | null;
    // "Nada encontrado" na Feegow volta como 409/422 em várias rotas: para a leitura, é lista vazia.
    if (r.status === 409 || r.status === 422) return [] as unknown as T;
    if (!r.ok || !corpo) throw new ErroFeegow(r.status, `Feegow respondeu ${r.status} em ${caminho.split('?')[0]}`);
    if (corpo.success === false) return [] as unknown as T;
    return corpo.content as T;
  }
  return {
    agendamentos: (profissionalId: string, de: string, ate: string) =>
      get<AgendamentoFeegow[]>('appoints/search', { profissional_id: profissionalId, data_start: de, data_end: ate }).then((x) => (Array.isArray(x) ? x : [])),
    profissionais: (ativo: 0 | 1) =>
      get<{ profissional_id: number; nome: string | null; tratamento?: string | null }[]>('professional/list', { ativo }).then((x) => (Array.isArray(x) ? x : [])),
    locais: () => get<{ id: number; local: string }[]>('company/list-local').then((x) => (Array.isArray(x) ? x : [])),
    status: () => get<{ id: number; status: string }[]>('appoints/status').then((x) => (Array.isArray(x) ? x : [])),
    tiposProcedimento: () => get<{ id: number; tipo: string }[]>('procedures/types').then((x) => (Array.isArray(x) ? x : [])),
    procedimentos: (tipo: number) => get<{ procedimento_id: number; nome: string }[]>('procedures/list', { tipo_procedimento: tipo }).then((x) => (Array.isArray(x) ? x : [])),
    paciente: (pacienteId: string) =>
      get<{ nome?: string | null; celulares?: (string | null)[]; telefones?: (string | null)[] } | unknown[]>('patient/search', { paciente_id: pacienteId })
        .then((x) => (x && !Array.isArray(x) ? x : null)),
  };
}

// Situação no CRM a partir do status da Feegow (lista em appoints/status).
export function situacaoDoStatus(statusId: unknown): 'agendado' | 'confirmado' | 'realizado' | 'cancelado' | 'faltou' {
  const s = Number(statusId);
  if (s === 7 || [2, 4, 5, 101, 103, 105].includes(s)) return 'confirmado';   // confirmado, ou já na clínica
  if (s === 3) return 'realizado';
  if (s === 6) return 'faltou';
  if (s === 11 || s === 15 || s === 16) return 'cancelado';                  // desmarcado ou remarcado (o novo horário é outro agendamento)
  return 'agendado';
}

// "R$ 1.300,50" → 1300.5
export function valorReais(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Data da Feegow (DD-MM-YYYY) ↔ ISO (YYYY-MM-DD)
export const isoDeFeegow = (d: string) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d ?? '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
export const feegowDeIso = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
