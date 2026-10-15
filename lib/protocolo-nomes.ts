// Acompanhamento de protocolo (migração 025, pedido da Letícia em 14/10): as situações e os nomes que a tela mostra.
// Vale no navegador e no servidor. A API aceita os mesmos ids (PROTOCOLOS em lib/api/servico.ts).
export type Situacao = 'em_analise' | 'em_protocolo' | 'em_acompanhamento' | 'encerrado';
export const SITUACOES: { id: Situacao; nome: string }[] = [
  { id: 'em_analise', nome: 'Em análise' },
  { id: 'em_protocolo', nome: 'Em protocolo' },
  { id: 'em_acompanhamento', nome: 'Em acompanhamento' },
  { id: 'encerrado', nome: 'Encerrado' },
];
export const nomeSituacao = (s: string | null | undefined) => SITUACOES.find((x) => x.id === s)?.nome ?? null;
export const ehSituacao = (s: unknown): s is Situacao => SITUACOES.some((x) => x.id === s);
