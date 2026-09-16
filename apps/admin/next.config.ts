import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @dsa/core ships raw TypeScript (its package main is src/index.ts).
  transpilePackages: ['@dsa/core'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
