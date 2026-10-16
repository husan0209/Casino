/**
 * Валидация query списков админки должна ВИСЕТЬ на query, а не только существовать.
 *
 * `ZodValidationPipe` по умолчанию обрабатывает только `body`: он вешается
 * скоупом на метод и применялся бы к `@CurrentUser()` и `@Param()` тоже
 * (найдено E2E, PR #15). Пять списков прилепили его как
 * `@UsePipes(new ZodValidationPipe(<QuerySchema>))` к методу с `@Query()` —
 * pipe проходил мимо. Итог на стенде: `GET /admin/payment-requests?per_page=5`
 * падает в 500, потому что в Prisma уходит `take: "5"` (строка), а обещанный
 * #231 «мусорный фильтр = 400, а не 500» не работал ни на одном из них.
 *
 * Спеки контроллера этого не ловили: они сами вызывали `Schema.parse()` и
 * передавали в метод уже разобранное, то есть проверяли схему и контроллер,
 * но не связку между ними. Здесь проверяется ровно связка — метаданные
 * `@UsePipes` и поведение pipe на `{ type: 'query' }`.
 */
import {
  BadRequestException,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common'
import { PIPES_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'

import { AdminAuditController } from '../src/modules/admin/presentation/controllers/admin-audit.controller'
import { AdminFinanceController } from '../src/modules/admin/presentation/controllers/admin-finance.controller'
import { AffiliateAdminController } from '../src/modules/affiliate/presentation/controllers/affiliate-admin.controller'

const QUERY_ARGUMENT = { type: 'query' } as ArgumentMetadata

type ControllerMethods = Record<string, (...args: never[]) => unknown>

interface QueryPipeCase {
  readonly name: string
  readonly methods: ControllerMethods
  readonly methodName: string
  /** Как приходит браузер: всё строки. Ожидаем на выходе числа. */
  readonly rawQuery: Record<string, string>
  readonly coerced: Record<string, unknown>
  /** Значение фильтра, которого нет в enum'ах БД. */
  readonly garbage: Record<string, string>
}

function queryPipeOf(methods: ControllerMethods, methodName: string): PipeTransform {
  const handler = methods[methodName]
  if (typeof handler !== 'function') {
    throw new Error(`метод ${methodName} не найден — тест пора переименовывать вместе с кодом`)
  }
  const pipes: unknown = Reflect.getMetadata(PIPES_METADATA, handler)
  if (!Array.isArray(pipes) || pipes.length === 0) {
    throw new Error(`на ${methodName} нет ни одного pipe — query не валидируется вообще`)
  }
  return pipes[0] as PipeTransform
}

function pick(result: unknown, keys: readonly string[]): Record<string, unknown> {
  const parsed = result as Record<string, unknown>
  return Object.fromEntries(keys.map((key) => [key, parsed[key]]))
}

const CASES: QueryPipeCase[] = [
  {
    name: 'GET /admin/transactions',
    methods: AdminFinanceController.prototype as unknown as ControllerMethods,
    methodName: 'transactions',
    rawQuery: { page: '2', per_page: '30' },
    coerced: { page: 2, per_page: 30 },
    garbage: { type: 'NOT_A_LEDGER_TYPE' },
  },
  {
    name: 'GET /admin/payment-requests',
    methods: AdminFinanceController.prototype as unknown as ControllerMethods,
    methodName: 'paymentRequests',
    rawQuery: { page: '1', per_page: '5', status: 'failed' },
    coerced: { page: 1, per_page: 5, status: 'failed' },
    garbage: { status: 'какашка' },
  },
  {
    name: 'GET /admin/withdrawals',
    methods: AdminFinanceController.prototype as unknown as ControllerMethods,
    methodName: 'withdrawals',
    rawQuery: { page: '1', per_page: '5' },
    coerced: { page: 1, per_page: 5 },
    garbage: { currency: 'EUR' },
  },
  {
    name: 'GET /admin/audit',
    methods: AdminAuditController.prototype as unknown as ControllerMethods,
    methodName: 'list',
    rawQuery: { page: '3', per_page: '7' },
    coerced: { page: 3, per_page: 7 },
    garbage: { actor_type: 'robot' },
  },
  {
    name: 'GET /admin/affiliate/attributions',
    methods: AffiliateAdminController.prototype as unknown as ControllerMethods,
    methodName: 'listAttributions',
    rawQuery: { page: '2', per_page: '10' },
    coerced: { page: 2, per_page: 10 },
    garbage: { status: 'на проверке' },
  },
]

describe('query-пайпы списков админки', () => {
  it.each(CASES)('$name: строки query превращаются в числа', (testCase) => {
    const pipe = queryPipeOf(testCase.methods, testCase.methodName)

    const result = pipe.transform(testCase.rawQuery, QUERY_ARGUMENT)

    expect(pick(result, Object.keys(testCase.coerced))).toEqual(testCase.coerced)
  })

  it.each(CASES)('$name: мусорный фильтр — 400, а не 500', (testCase) => {
    const pipe = queryPipeOf(testCase.methods, testCase.methodName)

    expect(() => pipe.transform(testCase.garbage, QUERY_ARGUMENT)).toThrow(BadRequestException)
  })
})
