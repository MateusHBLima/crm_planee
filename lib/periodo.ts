// Períodos de data do painel (11/10): CRM, Registro, Resultados e Agenda usam o mesmo filtro (components/FiltroData).
// Um período é um intervalo de dias inteiros, no fuso do painel, com início e fim inclusos: { de: '2026-10-01',
// ate: '2026-10-11' }. Este arquivo não importa nada do servidor: as telas também usam.

export type Intervalo = { de: string; ate: string };
export type Atalho = 'hoje' | 'ontem' | 'amanha' | '7d' | '30d' | 'mes' | 'mes_passado' | 'ano';

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_DIAS = 3700; // pouco mais de 10 anos

export function diaValido(s: unknown): s is string {
  const m = typeof s === 'string' ? DIA.exec(s) : null;
  if (!m) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && Number(m[1]) >= 2000 && Number(m[1]) <= 2100;
}

export function somaDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400_000);

// Lê de/até vindos da tela (ou da URL). Inválido ou ausente = null; invertido é corrigido; longo demais é recusado.
export function lerIntervalo(de: unknown, ate: unknown): Intervalo | null {
  if (!diaValido(de)) return null;
  const fim = diaValido(ate) ? ate : de;
  const [a, b] = de <= fim ? [de, fim] : [fim, de];
  if (diasEntre(a, b) > MAX_DIAS) return null;
  return { de: a, ate: b };
}

// Hoje no fuso pedido, como YYYY-MM-DD.
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1-12
const pad = (n: number) => String(n).padStart(2, '0');
export const diaDe = (ano: number, mes: number, dia: number) => `${ano}-${pad(mes)}-${pad(dia)}`;
export const mesInteiro = (ano: number, mes: number): Intervalo => ({ de: diaDe(ano, mes, 1), ate: diaDe(ano, mes, ultimoDiaDoMes(ano, mes)) });
export const anoInteiro = (ano: number): Intervalo => ({ de: `${ano}-01-01`, ate: `${ano}-12-31` });

export const NOMES_ATALHO: Record<Atalho, string> = {
  hoje: 'Hoje', ontem: 'Ontem', amanha: 'Amanhã', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias',
  mes: 'Este mês', mes_passado: 'Mês passado', ano: 'Este ano',
};

export function intervaloDoAtalho(a: Atalho, hoje: string): Intervalo {
  const [ano, mes] = hoje.split('-').map(Number);
  switch (a) {
    case 'hoje': return { de: hoje, ate: hoje };
    case 'ontem': { const d = somaDias(hoje, -1); return { de: d, ate: d }; }
    case 'amanha': { const d = somaDias(hoje, 1); return { de: d, ate: d }; }
    case '7d': return { de: somaDias(hoje, -6), ate: hoje };
    case '30d': return { de: somaDias(hoje, -29), ate: hoje };
    case 'mes': return { de: diaDe(ano, mes, 1), ate: hoje };
    case 'mes_passado': return mes === 1 ? mesInteiro(ano - 1, 12) : mesInteiro(ano, mes - 1);
    case 'ano': return { de: `${ano}-01-01`, ate: hoje };
  }
}

export function atalhoDe(i: Intervalo | null, hoje: string, atalhos: readonly Atalho[]): Atalho | null {
  if (!i) return null;
  return atalhos.find((a) => { const x = intervaloDoAtalho(a, hoje); return x.de === i.de && x.ate === i.ate; }) ?? null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (mes: number) => MESES[mes - 1];
export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const diaBr = (dia: string) => dia.split('-').reverse().join('/');

// Nome do período em português: "Hoje", "11 de outubro de 2026", "outubro de 2026", "2026", "01/10/2026 a 11/10/2026".
export function nomeIntervalo(i: Intervalo, hoje?: string, atalhos: readonly Atalho[] = ['hoje', 'ontem', 'amanha', '7d', '30d', 'mes', 'mes_passado', 'ano']): string {
  if (hoje) { const a = atalhoDe(i, hoje, atalhos); if (a) return NOMES_ATALHO[a]; }
  const [a1, m1, d1] = i.de.split('-').map(Number);
  const [a2, m2, d2] = i.ate.split('-').map(Number);
  if (i.de === i.ate) return `${d1} de ${nomeMes(m1)} de ${a1}`;
  if (a1 === a2 && m1 === m2 && d1 === 1 && d2 === ultimoDiaDoMes(a2, m2)) return `${nomeMes(m1)} de ${a1}`;
  if (a1 === a2 && m1 === 1 && d1 === 1 && m2 === 12 && d2 === 31) return String(a1);
  return `${diaBr(i.de)} a ${diaBr(i.ate)}`;
}
