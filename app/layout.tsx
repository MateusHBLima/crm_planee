import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '../design/tokens.css';

export const metadata: Metadata = {
  title: 'Painel Planee',
  description: 'Atendimento pelo WhatsApp e operação do agente de IA.',
};

// Aplica o tema salvo antes da primeira pintura, sem piscar.
const temaInicial = `try{var t=localStorage.getItem('tema');if(t!=='claro'&&t!=='escuro'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'escuro':'claro'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','claro')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="claro" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
      </head>
      <body style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
