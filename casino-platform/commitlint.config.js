module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'revert', 'wip', 'security'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'auth',
        'wallet',
        'payments',
        'casino',
        'kyc',
        'admin',
        'support',
        'referrals',
        'notifications',
        'users',
        'health',
        'database',
        'shared',
        'api',
        'web',
        'admin-ui',
        'infra',
        'deps',
        'ci',
        'docs',
        'security',
        'rg',
      ],
    ],
    // AI-agent driven repo: subjects like "P1 audit fixes" are legitimate
    'subject-case': [0],
    // GitHub squash-мержи автоматически добавляют в body Co-authored-by и
    // список коммитов ветки — строки часто длиннее 100. Правим сообщения при
    // мерже, но авто-вставку GitHub не контролируем; 200 покрывает её,
    // оставляя защиту от реально простыней.
    'body-max-line-length': [2, 'always', 200],
  },
}
