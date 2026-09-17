import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @dsa/core ships raw TypeScript (its package main is src/index.ts).
  transpilePackages: ['@dsa/core'],
  // Lets a second dev server (the mock-mode screenshot run) build next to a
  // running `npm run admin` without both writing into the same `.next`.
  distDir: process.env.DSA_ADMIN_DIST_DIR || '.next',
  eslint: { ignoreDuringBuilds: true },
  // The dev badge sits on top of the canvas zoom controls.
  devIndicators: false,
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
