// Verificação de saúde para o Docker e o Traefik (decisão 27). Não toca o banco:
// o painel no ar não pode depender de o banco responder para o contêiner ser considerado vivo.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, versao: process.env.PAINEL_VERSAO || 'dev' });
}
