// Etiquetas dos cartões (migração 032, 30/10): cores com os mesmos nomes do Trello, para a SSA copiar as etiquetas
// de lá do jeito que estão. Cada cor tem o fundo e a cor do texto da etiqueta. Este arquivo não importa nada do
// servidor: as telas também usam a lista.

const BASE: Record<string, [string, string, string]> = {
  // cor: [_light, normal, _dark]
  green: ['#BAF3DB', '#4BCE97', '#1F845A'],
  yellow: ['#F8E6A0', '#F5CD47', '#946F00'],
  orange: ['#FEDEC8', '#FEA362', '#C25100'],
  red: ['#FFD5D2', '#F87168', '#C9372C'],
  purple: ['#DFD8FD', '#9F8FEF', '#6E5DC6'],
  blue: ['#CCE0FF', '#579DFF', '#0C66E4'],
  sky: ['#C6EDFB', '#6CC3E0', '#227D9B'],
  lime: ['#D3F1A7', '#94C748', '#5B7F24'],
  pink: ['#FDD0EC', '#E774BB', '#AE4787'],
  black: ['#DCDFE4', '#8590A2', '#626F86'],
};

export const CORES_ETIQUETA: Record<string, { fundo: string; texto: string }> = Object.fromEntries(
  Object.entries(BASE).flatMap(([cor, [claro, normal, escuro]]) => [
    [`${cor}_light`, { fundo: claro, texto: '#172B4D' }],
    [cor, { fundo: normal, texto: '#172B4D' }],
    [`${cor}_dark`, { fundo: escuro, texto: '#FFFFFF' }],
  ]),
);

const SEM_COR = { fundo: '#DCDFE4', texto: '#172B4D' };
export const corDaEtiqueta = (cor: string | null | undefined) => (cor && CORES_ETIQUETA[cor]) || SEM_COR;
export const corEtiquetaValida = (v: unknown) => v === null || v === undefined || v === '' || Object.prototype.hasOwnProperty.call(CORES_ETIQUETA, String(v));
export const NOMES_CORES_ETIQUETA = Object.keys(CORES_ETIQUETA);

export type Etiqueta = { id: string; nome: string; cor: string | null; ordem: number; topico_destino: string | null; mover_de: string[]; mostrar: boolean };
