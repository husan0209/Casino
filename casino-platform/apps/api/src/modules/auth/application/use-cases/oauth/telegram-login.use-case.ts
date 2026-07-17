import { Injectable } from '@nestjs/common'
@Injectable()
export class TelegramLoginUseCase {
  async execute(_data: any) {
    // TODO: verify HMAC-SHA256 with TELEGRAM_BOT_TOKEN, find/create user
    throw new Error('Telegram Login not configured – add TELEGRAM_BOT_TOKEN')
  }
}
