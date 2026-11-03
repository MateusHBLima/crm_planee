import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { hostDeCabecalhos } from '@/lib/empresa';
import { appDoEndereco } from '@/lib/app-instalavel';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '../design/tokens.css';

const BASE: Metadata = {
  title: 'Painel Planee',
  description: 'Atendimento pelo WhatsApp e operação do agente de IA.',
};

// Endereço de empresa com o painel instalável (crm_config "app", lib/app-instalavel.ts): aponta o manifesto e o ícone
// para o celular. Nos outros endereços, nada muda.
export async function generateMetadata(): Promise<Metadata> {
  const app = await appDoEndereco(hostDeCabecalhos(await headers())).catch(() => null);
  if (!app) return BASE;
  return {
    ...BASE,
    manifest: '/manifest.webmanifest',
    icons: { apple: [{ url: '/app-icone/192', sizes: '192x192', type: 'image/png' }] },
    appleWebApp: { capable: true, title: app.nomeCurto, statusBarStyle: 'default' },
  };
}

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
