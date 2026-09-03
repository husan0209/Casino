module.exports = {
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // GAP-39 stage 8: правило поднято до error — в src не осталось any
    // (13 разобраны: api-клиент на ApiResponse<T>, типы DTO в pages)
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
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
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
      // Dashboard pages are declarative JSX blocks, not logic functions
      files: ['**/app/**/{page,layout,providers}.tsx'],
      rules: {
        'max-lines-per-function': ['warn', { max: 140, skipBlankLines: true, skipComments: true }],
        complexity: 'off',
        'max-depth': 'off',
      },
    },
  ],
}
