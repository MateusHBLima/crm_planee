import type { NextConfig } from 'next';

// Cabeçalhos de segurança em todas as respostas (auditoria 01/10, S8): só HTTPS, o painel não abre dentro de
// outro site (clickjacking), o navegador não adivinha tipo de arquivo e o endereço não vaza para outros sites.
const SEGURANCA = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imagem Docker enxuta para o Swarm (decisão 27).
  output: 'standalone',
  poweredByHeader: false,
  // Comprovante anexado pela tela (até 10 MB) vai numa ação do servidor.
  // staleTimes: voltar a uma tela visitada há menos de 30 s não pede a página de novo ao servidor (09/10). As telas
  // não trazem dados na página (vêm pelas leituras GET, que continuam conferindo sessão e permissão a cada pedido).
  experimental: { serverActions: { bodySizeLimit: '12mb' }, staleTimes: { dynamic: 30 } },
  async headers() {
    return [{ source: '/:path*', headers: SEGURANCA }];
  },
};

export default nextConfig;
