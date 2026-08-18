import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle in .next/standalone, which the
  // Dockerfile copies instead of shipping node_modules.
  output: 'standalone',

  // Fail the production build on type errors rather than shipping them.
  // Next 16 dropped the `eslint` key from this config and the `next lint`
  // command; linting runs through the eslint CLI instead (npm run lint).
  typescript: { ignoreBuildErrors: false },

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
