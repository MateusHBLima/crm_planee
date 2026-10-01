import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_ACESSO, fatoresTotp, inscreverTotp, nivelDaSessao, usuarioDoToken } from '@/lib/auth/gotrue';
import { destinoSeguro } from '@/lib/destino';
import { FormVerificacao } from './FormVerificacao';
import e from '../entrar.module.css';

export const metadata: Metadata = { title: 'Verificação · Painel Planee' };
export const dynamic = 'force-dynamic';

// Segundo fator do master (Supabase Auth MFA, TOTP). Primeira vez: cadastra o autenticador com o QR.
// Depois: só pede o código de 6 dígitos. Sem sessão (senha) válida, volta para o login.
export default async function Verificacao({ searchParams }: { searchParams: Promise<{ volta?: string }> }) {
  const volta = destinoSeguro((await searchParams).volta);
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso || !(await usuarioDoToken(acesso).catch(() => null))) redirect('/entrar?motivo=sessao');
  if (nivelDaSessao(acesso) === 'aal2') redirect(volta);

  const verificado = (await fatoresTotp(acesso)).find((f) => f.status === 'verified');
  const novo = verificado ? null : await inscreverTotp(acesso);

  return (
    <main className={e.pagina}>
      <section className={e.caixa} aria-labelledby="titulo">
        <div className={e.marca}>
          <span className={e.logo}>P</span>
          <div><div className={e.marcaNome}>Painel Planee</div><div className={e.marcaSub}>Acesso da Planee</div></div>
        </div>
        <h1 id="titulo" className={e.titulo}>{verificado ? 'Código do autenticador' : 'Ative o autenticador'}</h1>
        {verificado ? (
          <p className={e.sub}>Abra o aplicativo autenticador do celular e digite o código de 6 números do Painel Planee.</p>
        ) : novo ? (
          <>
            <p className={e.sub}>
              A conta da Planee abre todas as clínicas, então pede um segundo passo. Escaneie o QR com o Google Authenticator,
              o Microsoft Authenticator ou o 1Password e digite o código que aparecer.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={novo.qr} alt="QR para cadastrar o Painel Planee no aplicativo autenticador" width={180} height={180} className={e.qr} />
            {novo.segredo && <p className={e.segredo}>Sem câmera? Digite a chave: <code data-segredo>{novo.segredo}</code></p>}
          </>
        ) : (
          <p className={e.erro} role="alert">Não foi possível preparar o autenticador agora. Tente de novo em instantes.</p>
        )}
        {(verificado || novo) && <FormVerificacao fator={(verificado?.id ?? novo?.id) as string} volta={volta} />}
        <Link href="/entrar" className={e.link}>Entrar com outra conta</Link>
      </section>
    </main>
  );
}
