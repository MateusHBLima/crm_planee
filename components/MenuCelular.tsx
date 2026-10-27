'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icone } from './Icone';
import s from './shell.module.css';

// Menu no celular (27/10): até 760 px o menu lateral vira uma gaveta. No topo fica só uma barra fina com o botão ☰,
// a tela atual e a empresa; a gaveta traz tudo o que o menu lateral tem (telas, empresa, usuário, tema). Fecha ao
// trocar de tela, ao tocar fora e no Esc. No computador nada muda: a barra some e a lateral fica fixa como antes.
export function MenuCelular({ titulo, sub, children }: { titulo: string; sub: string; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const caminho = usePathname();
  useEffect(() => { setAberto(false); }, [caminho]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto]);
  return (
    <>
      <header className={s.barraCelular}>
        <button type="button" className={s.botaoMenu} aria-label="Abrir o menu" aria-expanded={aberto} aria-controls="menu-lateral"
          onClick={() => setAberto(true)} data-menu-celular>
          <Icone nome="menu" />
        </button>
        <span className={s.barraTexto}>
          <span className={s.barraTitulo}>{titulo}</span>
          <span className={s.barraSub}>{sub}</span>
        </span>
      </header>
      {aberto && <div className={s.veu} onClick={() => setAberto(false)} aria-hidden="true" />}
      <aside id="menu-lateral" className={s.lateral} data-aberto={aberto ? 'true' : 'false'}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setAberto(false); }}>
        <button type="button" className={s.fecharMenu} aria-label="Fechar o menu" onClick={() => setAberto(false)}>
          <Icone nome="fechar" />
        </button>
        {children}
      </aside>
    </>
  );
}
