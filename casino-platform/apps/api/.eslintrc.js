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
    '@typescript-eslint/prefer-nullish-coalescing': [
      'warn',
      { ignorePrimitives: true },
    ],
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
}