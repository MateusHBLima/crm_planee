import { hostDeCabecalhos } from '@/lib/empresa';
import { appDoEndereco } from '@/lib/app-instalavel';

export const dynamic = 'force-dynamic';

// Ícone do painel instalável (PWA) da empresa dona do endereço: /app-icone/192 e /app-icone/512.
export async function GET(req: Request, { params }: { params: Promise<{ tamanho: string }> }) {
  const { tamanho } = await params;
  if (tamanho !== '192' && tamanho !== '512') return new Response('Não encontrado', { status: 404 });
  const app = await appDoEndereco(hostDeCabecalhos(req.headers));
  if (!app) return new Response('Não encontrado', { status: 404 });
  return new Response(new Uint8Array(app.icones[tamanho]), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' } });
}
