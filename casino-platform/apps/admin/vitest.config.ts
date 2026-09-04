import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * GAP-44: vitest для apps/admin. Аналог web/vitest.config.ts.
 * Алиасы дублируются из tsconfig (Vite не подхватывает из tsconfig).
 * Тесты только для чистых функций (errText). React-компоненты — отдельный PR.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
  },
})
