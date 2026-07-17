import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return { success: true, data: { status: 'ok', timestamp: new Date().toISOString() } }
  }
  @Get('live')
  liveness() {
    return { success: true, data: { live: true } }
  }
  @Get('ready')
  readiness() {
    return { success: true, data: { ready: true } }
  }
}
