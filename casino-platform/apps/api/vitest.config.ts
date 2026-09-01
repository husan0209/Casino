import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * GAP-26: src/api использует tsconfig path-алиасы (@modules/*, @/*).
 * Vite их из tsconfig не подхватывает — объявляем явно, иначе спеки,
 * импортирующие модули api, не резолвятся.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Глобальные describe/it/expect — спеки не импортируют их из 'vitest'
    globals: true,
  },
})
