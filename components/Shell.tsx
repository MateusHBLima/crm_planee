import Link from 'next/link';
import type { Usuario } from '@/lib/sessao';
import { NOME_NIVEL } from '@/lib/permissoes';
import { telasDe } from '@/lib/telas';
import { bancoConfigurado } from '@/lib/db';
import { sair } from '@/app/entrar/acoes';
import { AlternarTema } from './AlternarTema';
import { Icone } from './Icone';
import { TrocarEmpresa } from './TrocarEmpresa';
import s from './shell.module.css';

export function Shell({ atual, usuario, largo, children }: {
  atual: string; usuario: Usuario; largo?: boolean; children: React.ReactNode;
}) {
  const telas = telasDe(usuario);
  const escolhe = !usuario.empresaFixa && usuario.empresas.length > 1;
  const banco = bancoConfigurado();
  return (
    <div className={s.app}>
      <aside className={s.lateral}>
        <div className={s.marca}>
          <span className={s.logo}>P</span>
          <div>
            <div className={s.marcaNome}>Painel Planee</div>
            <div className={s.marcaSub}>{usuario.empresa ? usuario.empresa.nome : 'Nenhuma empresa'}</div>
          </div>
        </div>
        {escolhe && <TrocarEmpresa atual={usuario.empresa?.id ?? null} empresas={usuario.empresas} />}
        <nav className={s.nav} aria-label="Telas">
          {telas.map((t) => (
            <Link key={t.id} href={`/${t.id}`} className={s.itemNav} aria-current={t.id === atual ? 'page' : undefined}>
              <Icone nome={t.icone} />
              <span>{t.nome}</span>
            </Link>
          ))}
        </nav>
        <div className={s.rodape}>
          <div className={s.usuario}>
            <span className={s.avatar} aria-hidden="true">{usuario.nome.trim().slice(0, 1).toUpperCase()}</span>
            <span className={s.usuarioTexto}>
              <span className={s.usuarioNome}>{usuario.nome}</span>
              <span className={s.usuarioPapel}>{NOME_NIVEL[usuario.nivel]}</span>
            </span>
            <form action={sair}>
              <button type="submit" className={s.sair} aria-label="Sair do painel" title="Sair">
                <Icone nome="sair" />
              </button>
            </form>
          </div>
          <AlternarTema />
          <div className={s.status}>
            <span className={banco ? s.pontoOk : s.pontoOff} aria-hidden="true" />
            {banco ? 'Banco conectado' : 'Banco não configurado'}
          </div>
        </div>
      </aside>
      <main className={largo ? s.conteudoLargo : s.conteudo}>{children}</main>
    </div>
  );
}
