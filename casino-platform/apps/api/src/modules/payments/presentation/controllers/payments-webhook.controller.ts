import { Body, Controller, Headers, Post, Req, HttpCode } from '@nestjs/common'
import { ProcessRukassaWebhookUseCase } from '../../application/use-cases/process-rukassa-webhook.use-case'
import { ProcessNOWPaymentsWebhookUseCase } from '../../application/use-cases/process-nowpayments-webhook.use-case'

@Controller('payments/webhooks')
export class PaymentsWebhookController {
  constructor(
    private rukassa: ProcessRukassaWebhookUseCase,
    private np: ProcessNOWPaymentsWebhookUseCase,
  ) {}
  @Post('rukassa')
  @HttpCode(200)
  async rukassaCb(@Headers() headers: any, @Body() body: any, @Req() req: any) {
    return this.rukassa.execute(headers, body, req.ip)
  }
  @Post('nowpayments')
  @HttpCode(200)
  async npCb(@Headers() headers: any, @Body() body: any, @Req() req: any) {
    return this.np.execute(headers, body, req.ip)
  }
}
