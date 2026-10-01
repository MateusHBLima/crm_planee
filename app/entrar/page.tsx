import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { nomeDoEndereco } from '@/lib/empresa';
import { usuarioAtual } from '@/lib/sessao';
import { destinoSeguro } from '@/lib/destino';
import { FormEntrar } from './FormEntrar';
import e from './entrar.module.css';

export const metadata: Metadata = { title: 'Entrar · Painel Planee' };
export const dynamic = 'force-dynamic';

const AVISOS: Record<string, string> = {
  sessao: 'Sua sessão terminou ou este usuário não tem mais acesso. Entre de novo.',
  empresa: 'Este usuário não tem acesso a esta empresa. Entre com outro e-mail ou peça acesso ao admin.',
  semtelas: 'Seu acesso ainda não tem nenhuma tela liberada. Peça ao admin da sua empresa.',
  mfa: 'Falta o código do aplicativo autenticador. Entre de novo para receber o pedido do código.',
};

export default async function Entrar({ searchParams }: { searchParams: Promise<{ volta?: string; motivo?: string }> }) {
  const { volta, motivo } = await searchParams;
  if (!motivo && (await usuarioAtual())) redirect(destinoSeguro(volta));
  const empresa = await nomeDoEndereco();
  return (
    <main className={e.pagina}>
      <section className={e.caixa} aria-labelledby="titulo">
        <div className={e.marca}>
          <span className={e.logo}>P</span>
          <div>
            <div className={e.marcaNome}>Painel Planee</div>
            {empresa && <div className={e.marcaSub}>{empresa}</div>}
          </div>
        </div>
        <h1 id="titulo" className={e.titulo}>Entrar</h1>
        <p className={e.sub}>Use o e-mail e a senha que a Planee liberou para você.</p>
        <FormEntrar volta={destinoSeguro(volta)} aviso={motivo ? AVISOS[motivo] ?? null : null} />
        <Link href="/entrar/primeiro-acesso" className={e.link}>Primeiro acesso? Crie sua senha</Link>
      </section>
    </main>
  );
}
