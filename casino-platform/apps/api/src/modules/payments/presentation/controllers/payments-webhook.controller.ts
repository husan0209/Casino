import { Body, Controller, Headers, Post, Req, HttpCode } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { ProcessNOWPaymentsWebhookUseCase } from '../../application/use-cases/process-nowpayments-webhook.use-case'
import { ProcessRukassaWebhookUseCase } from '../../application/use-cases/process-rukassa-webhook.use-case'

/**
 * Webhook controller.
 *
 * HMAC signature MUST be verified against the raw bytes of the HTTP body
 * (`req.rawBody`), not against the re-serialised JSON object. Re-serialised
 * JSON differs from the original in key order, whitespace, and number
 * formatting — which can both reject legitimate webhooks and (in some
 * implementations) let an attacker forge signatures.
 *
 * The rawBody is captured by express.json({ verify }) in main.ts and exposed
 * as req.rawBody (string). It is the ONLY reliable input for HMAC.
 */
// GAP-21 exemption: тело — payload платёжного провайдера (NOWPayments/…), формат
// не контролируется нами и проверяется HMAC-подписью в use-case. Жёсткая Zod-схема
// отбивала бы валидные вебхуки, поэтому сюда — только подпись, не схема.
@Controller('payments/webhooks')
// GAP-19: webhook'и провайдеров идут пачками с их IP — rate-limit их душит;
// защита — HMAC-подпись по rawBody (см. выше), а не троттлинг.
@SkipThrottle()
export class PaymentsWebhookController {
  constructor(
    private rukassa: ProcessRukassaWebhookUseCase,
    private np: ProcessNOWPaymentsWebhookUseCase,
  ) {}

  @Post('rukassa')
  @HttpCode(200)
  async rukassaCb(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: { rawBody?: string; ip?: string },
  ) {
    return this.rukassa.execute(headers, body, req.rawBody ?? '', req.ip ?? '')
  }

  @Post('nowpayments')
  @HttpCode(200)
  async npCb(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: { rawBody?: string; ip?: string },
  ) {
    return this.np.execute(headers, body, req.rawBody ?? '', req.ip ?? '')
  }
}
