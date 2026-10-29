// Permissões do painel (decisão 26). O master libera um conjunto para cada empresa (empresas.modulos);
// o admin tem tudo o que a empresa tem; o membro tem só o que o admin deu, dentro do que a empresa tem.
// Este arquivo não importa nada do servidor: as telas também usam a lista.
// Módulos (16/10, decisão 46): as permissões de cada módulo (lib/modulos.ts) entram no fim da lista, com o grupo
// do módulo. Elas só valem quando o módulo está ligado na empresa (marcado e com o SQL rodado no banco dela).
import { MODULOS, ehPermissaoDeModulo, moduloDaPermissao, type PermissaoModulo } from './modulos';

export type Nivel = 'master' | 'admin' | 'membro';

const BASE = [
  { id: 'inbox.ver', nome: 'Ver a inbox', grupo: 'Atendimento' },
  { id: 'inbox.responder', nome: 'Responder pelo painel', grupo: 'Atendimento' },
  { id: 'crm.ver', nome: 'Ver o CRM', grupo: 'CRM' },
  { id: 'crm.editar', nome: 'Assumir, mover e anotar atendimentos', grupo: 'CRM' },
  { id: 'crm.arquivar', nome: 'Arquivar atendimentos', grupo: 'CRM' },
  { id: 'crm.config', nome: 'Configurar o CRM (etapas, assuntos)', grupo: 'CRM' },
  { id: 'protocolos.ver', nome: 'Acompanhamento de protocolo', grupo: 'CRM' },
  { id: 'pagamentos.ver', nome: 'Ver agendamentos e comprovantes de pagamento', grupo: 'CRM' },
  { id: 'pagamentos.conferir', nome: 'Conferir comprovantes e registrar pagamentos', grupo: 'CRM' },
  { id: 'resultados.ver', nome: 'Ver resultados', grupo: 'Gestão' },
  { id: 'agente.config', nome: 'Configurar o agente de IA', grupo: 'Gestão' },
] as const;

export type Permissao = (typeof BASE)[number]['id'] | PermissaoModulo;
export type ItemPermissao = { id: Permissao; nome: string; grupo: string; modulo?: string };
export const PERMISSOES: ItemPermissao[] = [
  ...BASE.map((p) => ({ ...p })),
  ...MODULOS.flatMap((m) => m.permissoes.map((p) => ({ id: p.id, nome: p.nome, grupo: m.nome, modulo: m.id }))),
];
export const TODAS: Permissao[] = PERMISSOES.map((p) => p.id);
const DA_BASE: Permissao[] = BASE.map((p) => p.id);

// Recursos da empresa (29/10): a empresa tem ou não tem; quem tem a permissão indicada ao lado ganha junto, sem
// marcar pessoa por pessoa na Equipe. O master também só vê quando a empresa tem (a SSA via Protocolos, que é da
// clínica). Marcar na tela Empresas.
export const DA_EMPRESA: Partial<Record<Permissao, Permissao>> = { 'protocolos.ver': 'crm.ver' };
export const ehDaEmpresa = (p: string) => Object.prototype.hasOwnProperty.call(DA_EMPRESA, p);

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

// O que a pessoa pode fazer de fato nesta empresa. O master tem toda a base, mas módulo só quando a empresa tem
// (16/10): sem isso a Planee via "Condição comercial" no painel da clínica. Permissão de módulo só vale com o
// módulo ligado (ligados = ids dos módulos marcados e com o SQL rodado no banco da empresa).
export function efetivas(nivel: Nivel, modulosEmpresa: readonly string[], doVinculo: readonly string[],
  ligados: ReadonlySet<string> = new Set()): Permissao[] {
  const empresa = limparPermissoes(modulosEmpresa);
  const doModuloLigado = (p: Permissao) => !ehPermissaoDeModulo(p) || ligados.has(moduloDaPermissao(p)?.id ?? '');
  if (nivel === 'master') {
    const temNaEmpresa = new Set(empresa);
    return TODAS.filter((p) => ((DA_BASE.includes(p) && !ehDaEmpresa(p)) || temNaEmpresa.has(p)) && doModuloLigado(p));
  }
  if (nivel === 'admin') return empresa.filter(doModuloLigado);
  const minhas = new Set(doVinculo);
  const junto = (p: Permissao) => { const base = DA_EMPRESA[p]; return Boolean(base && minhas.has(base)); };
  return empresa.filter((p) => (minhas.has(p) || junto(p)) && doModuloLigado(p));
}
