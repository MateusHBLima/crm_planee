// Papéis de uma pessoa num número de WhatsApp (migração 024). Sem server-only: as telas usam os nomes.
// "responsavel" não é gravado: é o dono do número (quem conversa) quando nenhum titular paciente foi carregado.
export const PAPEIS = ['proprio', 'dependente', 'familiar', 'mesmo_numero', 'equipe_fornecedor'] as const;
export const NOME_PAPEL: Record<string, string> = {
  proprio: 'titular', responsavel: 'responsável pelo número', dependente: 'dependente', familiar: 'familiar', mesmo_numero: 'divide o número', equipe_fornecedor: 'equipe ou fornecedor',
};
