/* eslint-disable no-console, max-lines-per-function, max-depth, @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition -- автономный Node-скрипт проверки (CommonJS, без типов, линейный сценарий / обход AST), а не модуль приложения */
/**
 * Проверка DI-графа приложения (preview-режим Nest).
 *
 * ЗАЧЕМ. `tsc` и unit-тесты не ловят ошибки инъекции: провайдер с незакрытой
 * зависимостью компилируется, но падает только при поднятии контейнера Nest.
 * В проекте такое уже случалось дважды — OAuthUserProvisioningService был забыт
 * в providers (auth.module.ts), а QualifyAttributionsUseCase не был доступен
 * для MaintenanceModule (найдено этой проверкой при разработке ТЗ ч.8).
 *
 * `preview: true` разрешает ВЕСЬ граф провайдеров, но НЕ вызывает
 * lifecycle-хуки (onModuleInit / onApplicationBootstrap), поэтому подключения
 * к БД и Redis не происходит. Без этой проверки ошибка DI обнаружилась бы
 * только в проде.
 *
 * Запуск:
 *   pnpm --filter @casino/api build
 *   node apps/api/test/di-graph.check.js
 */
const { NestFactory } = require('@nestjs/core')

function setEnv() {
  process.env['NODE_ENV'] = 'test'
  // Секреты нужны для резолва ConfigService: в preview lifecycle-хуки не
  // выполняются, но ConfigModule всё равно валидирует схему при создании.
  process.env['AFFILIATE_JWT_SECRET'] = process.env['AFFILIATE_JWT_SECRET'] || 'x'.repeat(64)
  process.env['DATABASE_URL'] = process.env['DATABASE_URL'] || 'postgresql://u:p@localhost:5432/di'
  process.env['JWT_ACCESS_SECRET'] = process.env['JWT_ACCESS_SECRET'] || 'a'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] || 'b'.repeat(64)
  process.env['APP_URL'] = process.env['APP_URL'] || 'http://localhost:3000'
  process.env['ADMIN_URL'] = process.env['ADMIN_URL'] || 'http://localhost:3002'
  process.env['DOMAIN'] = process.env['DOMAIN'] || 'localhost'
  // Без Redis планировщик и воркеры молча выключаются — это нужно, чтобы
  // проверка не зависела от запущенного Redis. Именно поэтому ставим
  // заглушку, а НЕ удаляем переменную: env.validation.ts требует REDIS_URL
  // присутствовать, и удаление валило проверку на старте. Подключения к
  // Redis при preview: true не происходит — lifecycle-хуки не выполняются.
  process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://127.0.0.1:6379'
}

async function main() {
  setEnv()
  const { AppModule } = require('../dist/app.module')
  const { AffiliateFacade } = require('../dist/modules/affiliate/facade/affiliate.facade')
  const { WalletFacade } = require('../dist/modules/wallet/facade/wallet.facade')

  const app = await NestFactory.create(AppModule, { preview: true, logger: false })
  const affiliateFacade = app.get(AffiliateFacade, { strict: false })
  const walletFacade = app.get(WalletFacade, { strict: false })

  // Фасад партнёрской программы — единственная разрешённая точка входа
  // для других модулей. Проверяем весь публичный контракт: сломанный метод
  // обнаружится на вызывающем модуле, а не здесь.
  const expectedFacadeMethods = [
    'attributePlayer',
    'runDaily',
    'clawbackPlayer',
    'qualifyAttributions',
    'cleanupClicks',
  ]
  const missing = expectedFacadeMethods.filter(
    (name) => typeof affiliateFacade[name] !== 'function',
  )

  const checks = {
    affiliateFacade: affiliateFacade !== undefined && affiliateFacade !== null,
    walletFacade: walletFacade !== undefined && walletFacade !== null,
    facadeMethods: missing.length === 0 ? 'all present' : 'missing: ' + missing.join(', '),
  }

  await app.close()

  if (missing.length > 0) {
    throw new Error('DI check failed, facade methods missing: ' + missing.join(', '))
  }
  console.log('DI graph OK:', checks)
}

main().catch((err) => {
  console.error('DI graph FAILED:', err?.message ? err.message : String(err))
  process.exit(1)
})
