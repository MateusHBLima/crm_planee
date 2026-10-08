// Memória das telas no navegador (09/10): o último quadro, a lista de conversas e as conversas abertas ficam
// guardados enquanto a aba está aberta. Voltar para o CRM ou reabrir uma conversa mostra na hora o que já foi lido,
// e a tela atualiza em seguida. Só na memória da página (some ao recarregar ou fechar a aba): nada vai para o disco
// do computador (dados de saúde, LGPD). Cada empresa tem as suas chaves.

const guardado = new Map<string, { valor: unknown; em: number }>();
const LIMITE = 200;

export function lembrar(chave: string, valor: unknown) {
  if (typeof window === 'undefined') return;
  guardado.delete(chave);
  guardado.set(chave, { valor, em: Date.now() });
  // As mais antigas saem primeiro (o Map guarda a ordem de inclusão).
  while (guardado.size > LIMITE) guardado.delete(guardado.keys().next().value as string);
}

export function lembrado<T>(chave: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return guardado.get(chave)?.valor as T | undefined;
}

export function esquecerTudo() {
  guardado.clear();
}

// Uma busca só por chave ao mesmo tempo: a tela que abre e a leitura antecipada (Antecipar) dividem o mesmo pedido.
// Resultado ok vai para a memória; erro volta para quem pediu e nada fica guardado.
const emVoo = new Map<string, Promise<unknown>>();
export function buscarUmaVez<T>(chave: string, buscar: () => Promise<{ ok: true; dados: T } | { ok: false; erro: string; sair?: boolean }>) {
  const ja = emVoo.get(chave) as Promise<{ ok: true; dados: T } | { ok: false; erro: string; sair?: boolean }> | undefined;
  if (ja) return ja;
  const p = buscar().then((r) => { if (r.ok) lembrar(chave, r.dados); return r; }).finally(() => emVoo.delete(chave));
  emVoo.set(chave, p);
  return p;
}
