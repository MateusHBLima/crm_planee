import 'server-only';

// Limite de tentativas erradas (login, código de primeiro acesso, código do autenticador).
// Fica na memória de cada réplica: com 2 réplicas, o limite efetivo dobra, o que ainda barra a força bruta.
// Só as falhas contam; acertar zera o contador daquele e-mail.
const JANELA_MS = 15 * 60_000;
const falhas = new Map<string, { n: number; ate: number }>();

export const LIMITES = { email: 8, ip: 30 } as const;

function contagem(chave: string, agora: number): number {
  const f = falhas.get(chave);
  if (!f || f.ate <= agora) { falhas.delete(chave); return 0; }
  return f.n;
}

// true quando alguma das chaves já passou do limite.
export function bloqueado(chaves: [string, number][]): boolean {
  const agora = Date.now();
  return chaves.some(([k, max]) => contagem(k, agora) >= max);
}

export function registrarFalha(chaves: string[]) {
  const agora = Date.now();
  if (falhas.size > 5000) for (const [k, v] of falhas) if (v.ate <= agora) falhas.delete(k);
  for (const k of chaves) {
    const n = contagem(k, agora) + 1;
    falhas.set(k, { n, ate: agora + JANELA_MS });
  }
}

export function limparFalhas(chaves: string[]) {
  for (const k of chaves) falhas.delete(k);
}

// IP de quem chamou, como o Traefik repassa (primeiro da lista).
export function ipDe(h: Headers): string {
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'local';
}

export const MSG_LIMITE = 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.';
