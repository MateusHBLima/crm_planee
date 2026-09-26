'use client';

import { useEffect, useState } from 'react';
import { Icone } from './Icone';
import s from './shell.module.css';

type Tema = 'claro' | 'escuro';

export function AlternarTema() {
  const [tema, setTema] = useState<Tema>('claro');

  useEffect(() => {
    const atual = document.documentElement.getAttribute('data-theme');
    setTema(atual === 'escuro' ? 'escuro' : 'claro');
  }, []);

  function alternar() {
    const novo: Tema = tema === 'claro' ? 'escuro' : 'claro';
    document.documentElement.setAttribute('data-theme', novo);
    try { localStorage.setItem('tema', novo); } catch {}
    setTema(novo);
  }

  return (
    <button type="button" className={s.itemNav} onClick={alternar}
      title={tema === 'claro' ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}>
      <Icone nome={tema === 'claro' ? 'lua' : 'sol'} />
      <span>{tema === 'claro' ? 'Tema escuro' : 'Tema claro'}</span>
    </button>
  );
}
