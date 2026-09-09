import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * GAP-44: vitest для apps/admin. Аналог web/vitest.config.ts.
 * Алиасы дублируются из tsconfig (Vite не подхватывает из tsconfig).
 * environment: 'jsdom' + plugin-react — с GAP-44 stage 2 тестируем
 * и React-компоненты (smoke логина), не только чистые функции (errText).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
