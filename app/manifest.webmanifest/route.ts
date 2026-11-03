import { hostDeCabecalhos } from '@/lib/empresa';
import { appDoEndereco } from '@/lib/app-instalavel';

export const dynamic = 'force-dynamic';

// Manifesto do painel instalável (PWA): nome e ícone da empresa dona do endereço (crm_config "app").
export async function GET(req: Request) {
  const app = await appDoEndereco(hostDeCabecalhos(req.headers));
  if (!app) return new Response('Não encontrado', { status: 404 });
  const manifesto = {
    name: app.nome, short_name: app.nomeCurto, lang: 'pt-BR', start_url: '/', scope: '/', display: 'standalone',
    background_color: app.cor, theme_color: app.cor,
    icons: [
      { src: '/app-icone/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icone/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icone/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifesto), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
