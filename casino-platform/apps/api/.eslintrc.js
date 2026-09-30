module.exports = {
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // GAP-39 этап 4: правило поднято до error — в src не осталось неподавленных any
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    '@typescript-eslint/no-unnecessary-condition': 'warn',
    // ignorePrimitives: на строках/числах семантика || осознанная — пустая строка
    // и 0 часто невалидны (валюта, сумма, ключ) и должны фолбэкаться. Опция
    // оставляет правило включённым для nullable-объектов (GAP-39 stage 6).
    '@typescript-eslint/prefer-nullish-coalescing': ['warn', { ignorePrimitives: true }],
    '@typescript-eslint/prefer-optional-chain': 'warn',
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      },
    ],
  },
  overrides: [
    {
      // `src` и `test` читают один tsconfig.eslint.json и одни type-aware правила,
      // но mock-шум в спеках легален (docs/CONVENTIONS.md §11): фейки репозиториев
      // и кошельков заведомо неполные — `as any`/`Record<string, any>` в фикстуре
      // даёт каскад unsafe-* на каждое обращение, а не дефект. Осмысленные правила
      // (import/order, no-unused-vars, no-floating-promises, consistent-type-imports)
      // остаются error: их линтует и pre-commit, и CI с расширением `eslint src test`.
      files: ['test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
}
