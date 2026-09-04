import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * GAP-44: vitest для apps/web.
 * Алиасы дублируются из tsconfig.json — Vite их из tsconfig не подхватывает.
 * environment: 'node' (по умолчанию) — тестируем только чистые функции
 * (formatAmount, sortWallets, ...). Для React-компонентов нужен jsdom +
 * @testing-library/react — отдельный PR (GAP-44 P3, см. tracker).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@casino/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src', import.meta.url),
      ),
      '@casino/shared-utils': fileURLToPath(
        new URL('../../packages/shared-utils/src', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
  },
})
