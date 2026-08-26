import { Body, Controller, Headers, Post, Req, HttpCode } from '@nestjs/common'

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
@Controller('payments/webhooks')
export class PaymentsWebhookController {
  constructor(
    private rukassa: ProcessRukassaWebhookUseCase,
    private np: ProcessNOWPaymentsWebhookUseCase,
  ) {}

  @Post('rukassa')
  @HttpCode(200)
  async rukassaCb(@Headers() headers: Record<string, string>, @Body() body: unknown, @Req() req: { rawBody?: string; ip?: string }) {
    return this.rukassa.execute(headers, body, req.rawBody ?? '', req.ip ?? '')
  }

  @Post('nowpayments')
  @HttpCode(200)
  async npCb(@Headers() headers: Record<string, string>, @Body() body: unknown, @Req() req: { rawBody?: string; ip?: string }) {
    return this.np.execute(headers, body, req.rawBody ?? '', req.ip ?? '')
  }
}
