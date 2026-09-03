module.exports = {
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // GAP-39 stage 7: правило поднято до error — в src не осталось any
    // (55 разобраны: api-клиент на ApiResponse<T>, DTO в src/types/*)
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
    // и 0 невалидны (URL, сообщения, валюта) и должны фолбэкаться. Опция
    // оставляет правило включённым для nullable-объектов (GAP-39 stage 9).
    '@typescript-eslint/prefer-nullish-coalescing': [
      'warn',
      { ignorePrimitives: true },
    ],
    '@typescript-eslint/prefer-optional-chain': 'warn',
    'import/no-cycle': 'warn',
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
      // Pages and big sheet/handler components are declarative JSX blocks, not logic functions
      files: ['**/app/**/*.tsx', '**/components/**/*.tsx'],
      rules: {
        'max-lines-per-function': ['warn', { max: 140, skipBlankLines: true, skipComments: true }],
        complexity: 'off',
        'max-depth': 'off',
      },
    },
  ],
}
