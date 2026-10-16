import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Лаборатория лежит вне pnpm-workspace, поэтому workspace-пакеты ей нужны
 * алиасами: node_modules/@casino резолвится только из apps/*, а нам важны
 * те же money-хелперы, что и в бою.
 */
const packagesRoot = new URL('../../packages/', import.meta.url)

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      {
        find: '@casino/shared-utils',
        replacement: fileURLToPath(new URL('shared-utils/src/index.ts', packagesRoot)),
      },
      {
        find: '@casino/shared-types',
        replacement: fileURLToPath(new URL('shared-types/src/index.ts', packagesRoot)),
      },
    ],
  },
  test: {
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
})
