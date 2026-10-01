'use client';

import { useActionState, useEffect } from 'react';
import { verificarCodigo, type EstadoVerificacao } from '../acoes';
import e from '../entrar.module.css';

export function FormVerificacao({ fator, volta }: { fator: string; volta: string }) {
  const [estado, acao, enviando] = useActionState<EstadoVerificacao, FormData>(verificarCodigo, { erro: null });
  useEffect(() => { if (estado.destino) window.location.assign(estado.destino); }, [estado.destino]);
  return (
    <form action={acao} className={e.form} noValidate>
      <input type="hidden" name="fator" value={fator} />
      <input type="hidden" name="volta" value={volta} />
      <label className={e.campo}>
        <span>Código de 6 números</span>
        <input id="codigo" name="codigo" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required autoFocus />
      </label>
      {estado.erro && <p className={e.erro} role="alert">{estado.erro}</p>}
      <button type="submit" className={e.botao} disabled={enviando || Boolean(estado.destino)}>{enviando ? 'Conferindo…' : 'Confirmar'}</button>
    </form>
  );
}
