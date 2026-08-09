import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Workspace packages are TypeScript source, compiled by Next rather than pre-built. One less
  // build step, and the app always sees the code in the repository.
  transpilePackages: [
    '@langgol/domain',
    '@langgol/application',
    '@langgol/infrastructure',
    '@langgol/shared',
    '@langgol/i18n',
    '@langgol/ui',
    '@langgol/db',
  ],

  // Prisma must not be bundled into the server build.
  serverExternalPackages: ['@prisma/client'],

  // Pin file tracing to the monorepo. Without this Next walks up from the app directory and, on
  // Windows, hits the protected 'Application Data' junction in the user's home directory.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  // Workspace sources use Node16-style '.js' specifiers that point at '.ts' files. tsx and
  // vitest resolve these natively; webpack needs to be told. Without it every cross-package
  // import fails with 'Can't resolve ./client.js'.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
