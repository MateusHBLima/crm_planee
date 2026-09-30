import { ErroApi } from '@/lib/db';

// "(47) 99999-1234", "5547999991234", "47 9999-1234" → só dígitos com 55. Recusa o que não parece telefone.
export function normalizarTelefone(t: unknown): string {
  let d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) throw new ErroApi(400, 'Telefone inválido. Use DDD + número, ex.: (47) 99999-1234.');
  return d;
}

// Mesmo telefone com e sem o 9: DDD + últimos 8 dígitos (regra tel_chave). Usar com os dois parâmetros
// devolvidos em uma consulta: `substr(dig, 3, 2) = $a and right(dig, 8) = $b`.
export function chaveTelefone(tel: string): [string, string] {
  return [tel.slice(2, 4), tel.slice(-8)];
}

export const SQL_MESMO_TELEFONE = (col: string, a: number, b: number) =>
  `substr(regexp_replace(${col}, '\\D', '', 'g'), 3, 2) = $${a} and right(regexp_replace(${col}, '\\D', '', 'g'), 8) = $${b}`;
