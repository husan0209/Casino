import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { type Response } from 'express'

import { ProcessNOWPaymentsWebhookUseCase } from '../../application/use-cases/process-nowpayments-webhook.use-case'
import { ProcessRukassaWebhookUseCase } from '../../application/use-cases/process-rukassa-webhook.use-case'

/**
 * Webhook controller.
 *
 * NOWPayments (P0 #4): подпись IPN — HMAC-SHA512 по каноническому JSON
 * (sorted keys + compact + ensure_ascii + исходные числовые токены), fallback —
 * raw-body HMAC (совместимость). Raw-байты берутся из req.rawBody, который
 * каптурится express.json({ verify }) в main.ts.
 *
 * Rukassa: уведомление приходит form-urlencoded (`$_POST`), подпись — HMAC-SHA256
 * от `id|createdDateTime|amount` на API-токен в заголовке `Signature` (не по
 * raw-байтам тела). Ответ — голый текст: `OK` засчитывает доставку, любой другой
 * провайдер повторяет до 5 раз, поэтому JSON-конверт здесь недопустим.
 */
// GAP-21 exemption: тело — payload платёжного провайдера (NOWPayments/…), формат
// не контролируется нами и проверяется HMAC-подписью в use-case. Жёсткая Zod-схема
// отбивала бы валидные вебхуки, поэтому сюда — только подпись, не схема.
@Controller('payments/webhooks')
// GAP-19: webhook'и провайдеров идут пачками с их IP — rate-limit их душит;
// защита — HMAC-подпись (см. выше), а не троттлинг.
@SkipThrottle()
export class PaymentsWebhookController {
  constructor(
    @Inject(ProcessRukassaWebhookUseCase) private rukassa: ProcessRukassaWebhookUseCase,
    @Inject(ProcessNOWPaymentsWebhookUseCase) private np: ProcessNOWPaymentsWebhookUseCase,
  ) {}

  /**
   * Контракт Rukassa: HTTP-статус для них не значит ничего, решает тело.
   * Поэтому всегда 200 (AGENTS.md правило 9: вебхуку не отказываем статусом),
   * а исход — текстом: `OK` принимает доставку, `ERROR AMOUNT`/`FAIL` он
   * повторяет до 5 раз.
   */
  @Post('rukassa')
  async rukassaCb(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: { rawBody?: string; ip?: string },
    @Res() res: Response,
  ): Promise<Response> {
    const reply = await this.rukassa.execute({
      rawHeaders: headers,
      body: body as Record<string, unknown>,
      rawBody: req.rawBody ?? '',
      ip: req.ip ?? '',
    })
    return res.status(200).type('text/plain').send(reply)
  }

  @Post('nowpayments')
  @HttpCode(200)
  async npCb(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: { rawBody?: string; ip?: string },
  ): Promise<{ ok: boolean }> {
    return this.np.execute({
      rawHeaders: headers,
      body: body as Record<string, unknown>,
      rawBody: req.rawBody ?? '',
      ip: req.ip ?? '',
    })
  }
}
