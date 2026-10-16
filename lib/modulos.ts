// Módulos por empresa (16/10, decisão 46). Este arquivo só DESCREVE os módulos que existem no código; quem usa
// cada um fica em empresas.modulos (marcado pelo master na tela Empresas). Nada aqui diz qual empresa usa o quê.
// Não importa nada do servidor: as telas também usam a lista. A parte do servidor está em lib/modulos-servidor.ts.
//
// Um módulo está LIGADO numa empresa quando as duas coisas valem:
//   1) a permissão-base dele (a primeira da lista) está em empresas.modulos;
//   2) todas as migrações dele constam em painel_migracoes no banco DAQUELA empresa (migração 027).
// Marcado sem o SQL: a tela Empresas avisa e a API responde 409; nada consulta tabela que não existe.
// Permissão de módulo sempre começa com "m.<id do módulo>." para não se misturar com as da base.

export type PermissaoModulo = `m.${string}`;

export type DefModulo = {
  id: string;                                     // letras minúsculas, números e _ (2 a 40)
  nome: string;
  descricao: string;
  permissoes: { id: PermissaoModulo; nome: string }[]; // a primeira é a base: marcar ela liga o módulo
  migracoes: string[];                             // ids em painel_migracoes, ex.: "condicao_comercial/001"
  pasta: string;                                   // onde está o SQL, para a tela Empresas mostrar
};

// Módulo só de teste (testes/painel/modulos.js): existe apenas quando o build é feito com
// NEXT_PUBLIC_PAINEL_MODULO_TESTE=1 (rodar.sh). O build de produção não tem.
const MODULO_TESTE: DefModulo = {
  id: 'teste_notas', nome: 'Notas de teste', descricao: 'Módulo fictício que só existe nos testes do mecanismo.',
  permissoes: [
    { id: 'm.teste_notas.ver', nome: 'Ver as notas de teste' },
    { id: 'm.teste_notas.editar', nome: 'Editar as notas de teste' },
  ],
  migracoes: ['teste_notas/001'],
  pasta: 'testes/painel/modulos/teste_notas/',
};

export const MODULOS: DefModulo[] = [
  ...(process.env.NEXT_PUBLIC_PAINEL_MODULO_TESTE === '1' ? [MODULO_TESTE] : []),
];

export const ehPermissaoDeModulo = (p: string): p is PermissaoModulo => p.startsWith('m.');

export function moduloDaPermissao(p: string): DefModulo | undefined {
  return ehPermissaoDeModulo(p) ? MODULOS.find((m) => p.startsWith(`m.${m.id}.`)) : undefined;
}

export const moduloPorId = (id: string) => MODULOS.find((m) => m.id === id);

// Marcado na empresa = a permissão-base está em empresas.modulos.
export const moduloMarcado = (m: DefModulo, modulosEmpresa: readonly string[]) => modulosEmpresa.includes(m.permissoes[0].id);

// Situação de um módulo numa empresa, a partir do que está marcado e do que rodou no banco dela.
export type EstadoModulo = 'desligado' | 'sem_migracao' | 'ligado';
export function estadoDoModulo(m: DefModulo, modulosEmpresa: readonly string[], migracoes: ReadonlySet<string> | null): EstadoModulo {
  if (!moduloMarcado(m, modulosEmpresa)) return 'desligado';
  return migracoes && m.migracoes.every((x) => migracoes.has(x)) ? 'ligado' : 'sem_migracao';
}
