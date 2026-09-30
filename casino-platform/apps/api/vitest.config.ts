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
    // Интеграционные спеки (LEDGER_INTEGRATION: ledger/referral-payout/kyc-limit-rates)
    // гоняют Serializable-транзакции по одной БД — файловый параллелизм даёт
    // write conflicts/deadlocks и флак (PR #100/#102/#104). Сериализуем файлы:
    // цена — ~1-2 минуты CI, выигрыш — стабильность.
    fileParallelism: false,
  },
})
