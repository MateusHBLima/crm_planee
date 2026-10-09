import 'server-only';

// Cliente da API da Feegow (só leitura) para o espelho da agenda. O token NÃO fica no banco: vem da stack do painel,
// que só o Mateus preenche no Portainer, na variável FEEGOW_TOKENS, um par "empresa=token" por empresa, separados por
// vírgula (ex.: "neuro-essentia=<token>"). FEEGOW_TOKEN_<EMPRESA> (ex.: FEEGOW_TOKEN_TESTE) também vale, para os
// testes e para uso local. FEEGOW_API_URL troca o endereço (testes usam uma Feegow falsa).
// Documentação: docs.feegow.com (cópia no projeto). Datas da API: DD-MM-YYYY.

export const baseFeegow = () => (process.env.FEEGOW_API_URL || 'https://api.feegow.com/v1/api').replace(/\/+$/, '');
export const nomeVariavelToken = (empresaId: string) => `FEEGOW_TOKEN_${empresaId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
export function tokenFeegow(empresaId: string): string | null {
  const proprio = process.env[nomeVariavelToken(empresaId)]?.trim();
  if (proprio) return proprio;
  for (const par of (process.env.FEEGOW_TOKENS ?? '').split(/[,;\n]+/)) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === empresaId) return par.slice(i + 1).trim() || null;
  }
  return null;
}

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

// Situação no CRM a partir do status da Feegow. Os status padrão da Feegow (ids até 100) vão pelo id; os que cada
// clínica cria (ids acima de 100) vão pelo nome que a clínica deu (lista em appoints/status, guardada nos cadastros).
export type Situacao = 'agendado' | 'confirmado' | 'realizado' | 'cancelado' | 'faltou';
export function situacaoDoStatus(statusId: unknown, nome?: string | null): Situacao {
  const s = Number(statusId);
  if (s === 7 || s === 2 || s === 4 || s === 5) return 'confirmado';      // confirmado, em atendimento, aguardando, chamando
  if (s === 3) return 'realizado';
  if (s === 6) return 'faltou';
  if (s === 11 || s === 15 || s === 16) return 'cancelado';               // desmarcado ou remarcado (o novo horário é outro agendamento)
  if (s > 100 && nome) {
    const n = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/desmarc|cancel|remarc/.test(n)) return 'cancelado';
    if (/nao compareceu|falt/.test(n)) return 'faltou';
    if (/atendid|finaliz|realizad/.test(n)) return 'realizado';
    if (/nao confirm/.test(n)) return 'agendado';
    if (/confirm|aguard|chegou|recep|em atendimento|chamando|sala/.test(n)) return 'confirmado';
  }
  return 'agendado';
}

// "R$ 1.300,50" → 1300.5; "350.00" → 350; "1,300.50" → 1300.5. O último separador seguido de 1 ou 2 dígitos é o
// decimal; os outros são de milhar.
export function valorReais(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[^\d,.-]/g, '');
  if (!/\d/.test(t)) return null;
  const m = /^(.*?)[.,](\d{1,2})$/.exec(t);
  const n = m ? Number(`${m[1].replace(/[.,]/g, '')}.${m[2]}`) : Number(t.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Data e hora em que o agendamento foi marcado na Feegow ("2026-10-09 14:03:00", "09-10-2026 14:03" ou
// "09/10/2026 14:03") → "2026-10-09T14:03:00" (hora local da clínica, sem fuso), ou null.
export function marcadoEm(v: unknown): string | null {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  m = /^(\d{2})[-/](\d{2})[-/](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t) ?? null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00`;
  return null;
}

// Data da Feegow (DD-MM-YYYY) ↔ ISO (YYYY-MM-DD)
export const isoDeFeegow = (d: string) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d ?? '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
export const feegowDeIso = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
