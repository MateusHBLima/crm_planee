import type { Metadata } from 'next';
import Link from 'next/link';
import { FormConvite } from '../../FormConvite';
import { bancoConfigurado } from '@/lib/db';
import { lerLinkConvite } from '@/lib/painel/gestao';
import e from '../../entrar.module.css';

export const metadata: Metadata = { title: 'Convite · Painel Planee', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Link de convite de uso único (09/10). Página pública: só mostra o nome da empresa quando o link vale.
// O formulário fica montado mesmo depois que o link é gasto: a ação grava a sessão, o Next redesenha a página
// (agora com o link usado) e o formulário ainda precisa levar a pessoa para o painel.
export default async function Convite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = bancoConfigurado() ? await lerLinkConvite(token).catch(() => null) : null;
  return (
    <main className={e.pagina}>
      <section className={e.caixa} aria-labelledby="titulo">
        <FormConvite token={token} empresa={link?.empresa ?? null} />
        <Link href="/entrar" className={e.link}>Já tenho senha</Link>
      </section>
    </main>
  );
}
