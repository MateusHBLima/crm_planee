// Decisão 21: um deploy por cliente. O modo vem da variável do projeto na Vercel,
// nunca do endereço acessado: o app não escolhe banco em tempo de execução.

export type Modo = 'adm' | 'cliente';

export function modoDoDeploy(): Modo {
  return process.env.PAINEL_MODO === 'adm' ? 'adm' : 'cliente';
}

export function clienteDoDeploy(): string | null {
  const nome = process.env.PAINEL_CLIENTE_NOME?.trim();
  return nome ? nome : null;
}
