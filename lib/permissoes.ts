// Permissões do painel (decisão 26). O master libera um conjunto para cada empresa (empresas.modulos);
// o admin tem tudo o que a empresa tem; o membro tem só o que o admin deu, dentro do que a empresa tem.
// Este arquivo não importa nada do servidor: as telas também usam a lista.

export type Nivel = 'master' | 'admin' | 'membro';

export const PERMISSOES = [
  { id: 'inbox.ver', nome: 'Ver a inbox', grupo: 'Atendimento' },
  { id: 'inbox.responder', nome: 'Responder pelo painel', grupo: 'Atendimento' },
  { id: 'crm.ver', nome: 'Ver o CRM', grupo: 'CRM' },
  { id: 'crm.editar', nome: 'Assumir, mover e anotar atendimentos', grupo: 'CRM' },
  { id: 'crm.arquivar', nome: 'Arquivar atendimentos', grupo: 'CRM' },
  { id: 'crm.config', nome: 'Configurar o CRM (etapas, assuntos)', grupo: 'CRM' },
  { id: 'pagamentos.ver', nome: 'Ver agendamentos e comprovantes de pagamento', grupo: 'CRM' },
  { id: 'pagamentos.conferir', nome: 'Conferir comprovantes e registrar pagamentos', grupo: 'CRM' },
  { id: 'resultados.ver', nome: 'Ver resultados', grupo: 'Gestão' },
  { id: 'agente.config', nome: 'Configurar o agente de IA', grupo: 'Gestão' },
] as const;

export type Permissao = (typeof PERMISSOES)[number]['id'];
export const TODAS: Permissao[] = PERMISSOES.map((p) => p.id);

// Modelos prontos que o admin aplica com um clique.
export const MODELOS: Record<'secretaria' | 'gestor', { nome: string; permissoes: Permissao[] }> = {
  secretaria: { nome: 'Secretária', permissoes: ['inbox.ver', 'inbox.responder', 'crm.ver', 'crm.editar'] },
  gestor: { nome: 'Gestor', permissoes: ['inbox.ver', 'inbox.responder', 'crm.ver', 'crm.editar', 'crm.arquivar', 'crm.config', 'resultados.ver'] },
};

export const NOME_NIVEL: Record<Nivel, string> = { master: 'Master', admin: 'Admin', membro: 'Membro' };

// Só chaves conhecidas, sem repetição, na ordem da lista.
export function limparPermissoes(lista: unknown): Permissao[] {
  const pedidas = new Set(Array.isArray(lista) ? lista.map(String) : []);
  return TODAS.filter((p) => pedidas.has(p));
}

// O que a pessoa pode fazer de fato nesta empresa.
export function efetivas(nivel: Nivel, modulosEmpresa: readonly string[], doVinculo: readonly string[]): Permissao[] {
  if (nivel === 'master') return [...TODAS];
  const empresa = limparPermissoes(modulosEmpresa);
  if (nivel === 'admin') return empresa;
  const minhas = new Set(doVinculo);
  return empresa.filter((p) => minhas.has(p));
}
