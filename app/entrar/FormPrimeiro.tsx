'use client';

import { useActionState, useEffect } from 'react';
import { criarSenha, type EstadoPrimeiro } from './acoes';
import e from './entrar.module.css';

export function FormPrimeiro() {
  const [estado, acao, enviando] = useActionState<EstadoPrimeiro, FormData>(criarSenha, { erro: null, email: '', enviado: false });
  useEffect(() => { if (estado.destino) window.location.assign(estado.destino); }, [estado.destino]);
  if (estado.enviado) {
    return <p className={e.ok} role="status">Enviamos um e-mail para {estado.email}. Confirme por lá e depois entre com a senha que você criou.</p>;
  }
  return (
    <form action={acao} className={e.form} noValidate>
      <label className={e.campo}>
        <span>E-mail cadastrado</span>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={estado.email} autoFocus />
      </label>
      <label className={e.campo}>
        <span>Nova senha (mínimo 8 caracteres)</span>
        <input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={8} />
      </label>
      <label className={e.campo}>
        <span>Repita a senha</span>
        <input id="repete" name="repete" type="password" autoComplete="new-password" required minLength={8} />
      </label>
      {estado.erro && <p className={e.erro} role="alert">{estado.erro}</p>}
      <button type="submit" className={e.botao} disabled={enviando || Boolean(estado.destino)}>{enviando ? 'Criando…' : 'Criar senha e entrar'}</button>
    </form>
  );
}
