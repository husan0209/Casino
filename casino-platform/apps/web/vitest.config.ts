import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * GAP-44: vitest для apps/web.
 * Алиасы дублируются из tsconfig.json — Vite их из tsconfig не подхватывает.
 * environment: 'jsdom' + plugin-react — с GAP-44 stage 2 тестируем
 * и React-компоненты (DepositSheet CTA, KYC-страница), не только
 * чистые функции (formatAmount, sortWallets, ...).
 */
export default defineConfig({
  plugins: [react()],
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
    environment: 'jsdom',
  },
})
