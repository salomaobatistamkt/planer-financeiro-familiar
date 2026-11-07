/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  // os dados iniciais (seed/) precisam ir junto no build standalone
  outputFileTracingIncludes: { '/api/**': ['./seed/**'], '/': ['./seed/**'] },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }];
  },
};
module.exports = nextConfig;
