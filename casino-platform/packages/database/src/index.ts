import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['DB_LOG_QUERIES'] === 'true' ? ['query', 'error', 'warn'] : ['error'],
  })
if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma
}
export * from '@prisma/client'
// Витрина демо-провайдера: один список на сид и на адаптер (@casino/database),
// иначе карточка и запуск разъезжаются молча.
export * from './seed-demo-games'
