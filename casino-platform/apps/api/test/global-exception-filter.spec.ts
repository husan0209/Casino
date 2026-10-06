/**
 * Коды ошибок валидации наружу (response-контракт).
 *
 * Зачем отдельная спека на фильтр: `code` для клиента — единственное, по чему фронт
 * может отличить «не то поле» от «вообще сломалось» и показать человеческий текст.
 * `ZodValidationPipe` кладёт `VALIDATION_ERROR` в payload, но фильтр читал только
 * дефолтное поле Nest (`error`), поэтому на провод уходил `HTTP_ERROR` — и это не
 * ловилось нигде: unit-спека pipe'а проверяет бросок, а не то, что отдаёт HTTP.
 * Поймано e2e-спекой кабинета (`test/e2e/affiliate-cabinet.e2e.spec.ts`, шаг 6).
 */
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { AppError } from '@casino/shared-utils'

import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter'

import type { ArgumentsHost } from '@nestjs/common'
import type { Response } from 'express'
import type { PinoLogger } from 'nestjs-pino'

class StubPinoLogger {
  setContext(): void {
    // контекст для теста не значим
  }

  error(): void {
    // 4xx и unknown логируются — в тесте молчим
  }
}

type Captured = { status: number; body: Record<string, unknown> }

/** Минимальный двойник express-ответа: цепочка status().json() и запись последнего тела. */
function respondTo(filter: GlobalExceptionFilter, exception: unknown): Captured {
  const captured: Partial<Captured> = {}
  const response = {
    status(code: number) {
      captured.status = code
      return this
    },
    json(body: unknown) {
      captured.body = body as Record<string, unknown>
      return this
    },
  }
  const host = {
    switchToHttp: () => ({
      getResponse: () => response as unknown as Response,
      getRequest: () => ({ id: 'req-test' }),
    }),
  } as unknown as ArgumentsHost

  filter.catch(exception, host)
  return { status: captured.status ?? 0, body: captured.body ?? {} }
}

function errorOf(body: Record<string, unknown>): Record<string, unknown> {
  const envelope = body['error']
  return typeof envelope === 'object' && envelope !== null
    ? (envelope as Record<string, unknown>)
    : {}
}

class DomainError extends AppError {
  readonly code = 'AFFILIATE_NOT_ACTIVE'
  readonly httpStatus = HttpStatus.FORBIDDEN
}

describe('GlobalExceptionFilter: стабильный код ошибки', () => {
  const filter = new GlobalExceptionFilter(new StubPinoLogger() as unknown as PinoLogger)

  it('у HttpException с явным code в payload берёт его, а не HTTP_ERROR', () => {
    const res = respondTo(
      filter,
      new BadRequestException({ code: 'VALIDATION_ERROR', message: ['days должен быть числом'] }),
    )
    expect(res.status).toBe(400)
    expect(errorOf(res.body)['code']).toBe('VALIDATION_ERROR')
  })

  it('без явного code остаётся дефолт Nest (BAD_REQUEST) — прежнего поведения не теряем', () => {
    const res = respondTo(filter, new BadRequestException('плохой запрос'))
    expect(res.status).toBe(400)
    expect(errorOf(res.body)['code']).toBe('BAD_REQUEST')
  })

  it('код нормализуется в UPPER_SNAKE (пробелы → подчёркивания)', () => {
    const res = respondTo(
      filter,
      new HttpException({ error: 'payment too small' }, HttpStatus.UNPROCESSABLE_ENTITY),
    )
    expect(res.status).toBe(422)
    expect(errorOf(res.body)['code']).toBe('PAYMENT_TOO_SMALL')
  })

  it('пустой code не уходит наружу как «пустой код»', () => {
    // Пробельный `code` — ошибка бросившего, а не код: наружу должен пойти
    // резервный HTTP_ERROR, а не `''` (клиент по пустому коду не различает ничего).
    const res = respondTo(filter, new BadRequestException({ code: '   ', message: 'x' }))
    expect(res.status).toBe(400)
    expect(errorOf(res.body)['code']).toBe('HTTP_ERROR')
  })

  it('AppError идёт своей веткой: код и httpStatus из класса', () => {
    const res = respondTo(filter, new DomainError('Партнёр не активен'))
    expect(res.status).toBe(403)
    expect(errorOf(res.body)['code']).toBe('AFFILIATE_NOT_ACTIVE')
  })

  it('неизвестная ошибка — 500 и INTERNAL_ERROR без деталей наружу', () => {
    const res = respondTo(filter, new Error('сырое сообщение с деталями upstream'))
    expect(res.status).toBe(500)
    expect(errorOf(res.body)['code']).toBe('INTERNAL_ERROR')
    expect(errorOf(res.body)['message']).not.toContain('upstream')
  })
})
