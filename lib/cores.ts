// Cores de fundo das colunas do quadro (migração 021, 11/10). A coluna guarda só a chave; o tom de cada tema
// (claro e escuro) sai do CSS do quadro. Este arquivo não importa nada do servidor: as telas também usam a lista.

export const CORES = [
  { id: 'cinza', nome: 'Cinza', amostra: '#8a8880' },
  { id: 'azul', nome: 'Azul', amostra: '#2f6fd6' },
  { id: 'ciano', nome: 'Ciano', amostra: '#1597a8' },
  { id: 'verde', nome: 'Verde', amostra: '#2f9a5b' },
  { id: 'amarelo', nome: 'Amarelo', amostra: '#d1a000' },
  { id: 'laranja', nome: 'Laranja', amostra: '#e07a1f' },
  { id: 'vermelho', nome: 'Vermelho', amostra: '#d13438' },
  { id: 'rosa', nome: 'Rosa', amostra: '#d6458f' },
  { id: 'roxo', nome: 'Roxo', amostra: '#8a55d6' },
] as const;

export type Cor = (typeof CORES)[number]['id'];
const IDS = new Set<string>(CORES.map((c) => c.id));

// Vazio = sem cor. Valor fora da paleta: null (a tela não quebra por um valor antigo ou digitado errado).
export function limparCor(v: unknown): Cor | null {
  const s = String(v ?? '').trim().toLowerCase();
  return IDS.has(s) ? (s as Cor) : null;
}
export const corValida = (v: unknown) => v === null || v === undefined || v === '' || IDS.has(String(v));
