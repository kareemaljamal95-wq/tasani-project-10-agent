import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    turbo: {},
  },
};

export default nextConfig;
