import 'server-only';
import { ErroApi, registrarErro } from '@/lib/db';
import { usuarioAtual, type Usuario } from '@/lib/sessao';

// Envelope das ações chamadas pelas telas. Cada ação confere a sessão de novo (nunca confia no navegador)
// e devolve erro em texto claro; erro inesperado vai para o log sem dado pessoal.

export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: string; sair?: boolean };

export async function comUsuario<T>(fn: (u: Usuario) => Promise<T>, onde = 'tela'): Promise<Resposta<T>> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sua sessão terminou. Entre de novo.', sair: true };
  try {
    return { ok: true, dados: await fn(u) };
  } catch (e) {
    if (e instanceof ErroApi) return { ok: false, erro: e.message };
    registrarErro(onde, e);
    return { ok: false, erro: 'Não foi possível concluir agora. Tente de novo em instantes.' };
  }
}
