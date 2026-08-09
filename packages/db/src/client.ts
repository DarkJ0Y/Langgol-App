/**
 * Prisma client singleton.
 *
 * A new PrismaClient per hot-reload in development exhausts the connection pool within a few
 * minutes, so the instance is cached on globalThis in non-production only.
 */

import { PrismaClient } from '../generated/client/index.js'

const globalForPrisma = globalThis as unknown as { langgolPrisma?: PrismaClient }

function createClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  })
}

export const prisma: PrismaClient = globalForPrisma.langgolPrisma ?? createClient()

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.langgolPrisma = prisma
}
