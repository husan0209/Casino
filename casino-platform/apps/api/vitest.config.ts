import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Глобальные describe/it/expect — спеки не импортируют их из 'vitest'
    globals: true,
  },
})
