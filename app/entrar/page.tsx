import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { clienteDoDeploy } from '@/lib/modo';
import { usuarioAtual } from '@/lib/sessao';
import { FormEntrar } from './FormEntrar';
import e from './entrar.module.css';

export const metadata: Metadata = { title: 'Entrar · Painel Planee' };
export const dynamic = 'force-dynamic';

const AVISOS: Record<string, string> = {
  sessao: 'Sua sessão terminou ou este usuário não tem mais acesso. Entre de novo.',
};

export default async function Entrar({ searchParams }: { searchParams: Promise<{ volta?: string; motivo?: string }> }) {
  const { volta, motivo } = await searchParams;
  if (!motivo && (await usuarioAtual())) redirect(volta && volta.startsWith('/') && !volta.startsWith('//') ? volta : '/');
  const cliente = clienteDoDeploy();
  return (
    <main className={e.pagina}>
      <section className={e.caixa} aria-labelledby="titulo">
        <div className={e.marca}>
          <span className={e.logo}>P</span>
          <div>
            <div className={e.marcaNome}>Painel Planee</div>
            {cliente && <div className={e.marcaSub}>{cliente}</div>}
          </div>
        </div>
        <h1 id="titulo" className={e.titulo}>Entrar</h1>
        <p className={e.sub}>Use o e-mail e a senha que a Planee liberou para você.</p>
        <FormEntrar volta={volta ?? '/'} aviso={motivo ? AVISOS[motivo] ?? null : null} />
      </section>
    </main>
  );
}
