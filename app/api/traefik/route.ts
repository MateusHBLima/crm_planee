import { NextResponse, type NextRequest } from 'next/server';
import { central, registrarErro } from '@/lib/db';

// Domínios das empresas para o Traefik (decisão 26): o Traefik do manager consulta este endereço de tempos em
// tempos (provedor HTTP) e cria uma rota com HTTPS para cada domínio cadastrado na tela Empresas.
// Cadastrar domínio vira só a tela do master + o DNS; nada de editar a stack.
// Resposta no formato de configuração dinâmica do Traefik v3.
// Só responde a quem chama pela rede interna do Swarm (Host sem ponto, ex.: painel_painel:3000) ou localhost.
// Pelo endereço público (adm.planeelabia.com/api/traefik) dá 404: a lista de clientes não fica exposta (S11).

export const dynamic = 'force-dynamic';

function chamadaInterna(req: NextRequest): boolean {
  const host = (req.headers.get('host') || '').replace(/:\d+$/, '').toLowerCase();
  return Boolean(host) && !host.includes('.');
}

export async function GET(req: NextRequest) {
  if (!chamadaInterna(req)) return NextResponse.json({ erro: 'Não encontrado.' }, { status: 404 });
  try {
    const r = await central().query(
      `select d.dominio from empresa_dominios d join empresas e on e.id = d.empresa_id where e.ativo order by d.dominio`,
    );
    const servico = process.env.TRAEFIK_SERVICO || 'painel@swarm';
    const entrada = process.env.TRAEFIK_ENTRYPOINT || 'websecure';
    const certificado = process.env.TRAEFIK_CERTRESOLVER || 'letsencryptresolver';
    const routers: Record<string, unknown> = {};
    for (const { dominio } of r.rows as { dominio: string }[]) {
      if (!/^[a-z0-9.-]+$/.test(dominio)) continue;
      routers[`empresa-${dominio.replace(/\./g, '-')}`] = {
        rule: `Host(\`${dominio}\`)`, entryPoints: [entrada], service: servico, tls: { certResolver: certificado },
      };
    }
    return NextResponse.json({ http: { routers } }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    // Erro: 503, e o Traefik mantém a última configuração que conseguiu ler.
    registrarErro('traefik', e);
    return NextResponse.json({ erro: 'Banco central indisponível.' }, { status: 503 });
  }
}
