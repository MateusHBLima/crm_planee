'use client';

import { useTransition } from 'react';
import { trocarEmpresa } from '@/lib/painel/acoes-gestao';
import s from './shell.module.css';

// Faixa no topo quando o master está dentro de uma empresa: deixa claro de quem são os dados na tela.
export function SairDaEmpresa({ nome }: { nome: string }) {
  const [ocupado, iniciar] = useTransition();
  return (
    <div className={s.faixaEmpresa} role="note">
      <span>Você está vendo a empresa <strong>{nome}</strong></span>
      <button type="button" disabled={ocupado}
        onClick={() => iniciar(async () => { const r = await trocarEmpresa(''); if (r.ok) window.location.assign('/'); })}>
        Sair da empresa
      </button>
    </div>
  );
}
