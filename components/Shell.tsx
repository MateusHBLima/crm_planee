import Link from 'next/link';
import type { Modo } from '@/lib/modo';
import { telasDo } from '@/lib/telas';
import { supabaseConfigurado } from '@/lib/supabase';
import { AlternarTema } from './AlternarTema';
import { Icone } from './Icone';
import s from './shell.module.css';

export function Shell({ modo, atual, cliente, children }: {
  modo: Modo; atual: string; cliente: string | null; children: React.ReactNode;
}) {
  const telas = telasDo(modo);
  const banco = supabaseConfigurado();
  return (
    <div className={s.app}>
      <aside className={s.lateral}>
        <div className={s.marca}>
          <span className={s.logo}>P</span>
          <div>
            <div className={s.marcaNome}>Painel Planee</div>
            <div className={s.marcaSub}>{modo === 'adm' ? 'Planee · acesso total' : cliente ? `Cliente · ${cliente}` : 'Cliente'}</div>
          </div>
        </div>
        <nav className={s.nav} aria-label="Telas">
          {telas.map((t) => (
            <Link key={t.id} href={`/${t.id}`} className={s.itemNav} aria-current={t.id === atual ? 'page' : undefined}>
              <Icone nome={t.icone} />
              <span>{t.nome}</span>
            </Link>
          ))}
        </nav>
        <div className={s.rodape}>
          <AlternarTema />
          <div className={s.status}>
            <span className={banco ? s.pontoOk : s.pontoOff} aria-hidden="true" />
            {banco ? 'Supabase conectado' : 'Supabase não configurado'}
          </div>
        </div>
      </aside>
      <main className={s.conteudo}>{children}</main>
    </div>
  );
}
