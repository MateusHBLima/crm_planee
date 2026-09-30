import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imagem Docker enxuta para o Swarm (decisão 27).
  output: 'standalone',
};

export default nextConfig;
