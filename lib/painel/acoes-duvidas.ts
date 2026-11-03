'use server';

import { comUsuario } from './resposta';
import * as d from './duvidas';

// Aba Dúvidas (módulo duvidas): cada ação confere a sessão, a empresa e a permissão m.duvidas.ver no servidor.
export async function perguntarDuvida(texto: string) {
  return comUsuario((u) => d.perguntar(u, texto), 'duvidas');
}

export async function carregarDuvidas() {
  return comUsuario((u) => d.minhasDuvidas(u), 'duvidas');
}
