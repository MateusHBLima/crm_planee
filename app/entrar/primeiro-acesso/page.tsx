import type { Metadata } from 'next';
import Link from 'next/link';
import { FormPrimeiro } from '../FormPrimeiro';
import { nomeDoEndereco } from '@/lib/empresa';
import e from '../entrar.module.css';

export const metadata: Metadata = { title: 'Primeiro acesso · Painel Planee' };
export const dynamic = 'force-dynamic';

export default async function PrimeiroAcesso() {
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
        <h1 id="titulo" className={e.titulo}>Primeiro acesso</h1>
        <p className={e.sub}>Crie a sua senha com o e-mail que o admin da sua empresa cadastrou.</p>
        <FormPrimeiro />
        <Link href="/entrar" className={e.link}>Já tenho senha</Link>
      </section>
    </main>
  );
}
