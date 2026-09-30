'use client';

import { useActionState } from 'react';
import { entrar, type EstadoEntrar } from './acoes';
import e from './entrar.module.css';

export function FormEntrar({ volta, aviso }: { volta: string; aviso: string | null }) {
  const [estado, acao, enviando] = useActionState<EstadoEntrar, FormData>(entrar, { erro: null, email: '' });
  const erro = estado.erro ?? aviso;
  return (
    <form action={acao} className={e.form} noValidate>
      <input type="hidden" name="volta" value={volta} />
      <label className={e.campo}>
        <span>E-mail</span>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={estado.email} autoFocus />
      </label>
      <label className={e.campo}>
        <span>Senha</span>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required />
      </label>
      {erro && <p className={e.erro} role="alert">{erro}</p>}
      <button type="submit" className={e.botao} disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}
