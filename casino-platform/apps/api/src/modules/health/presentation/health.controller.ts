import { Controller, Get } from '@nestjs/common'
@Controller('health')
export class HealthController {
  @Get() getHealth() { return { status: 'ok', timestamp: new Date().toISOString() } }
  @Get('live') liveness() { return { live: true } }
  @Get('ready') readiness() { return { ready: true } }
}
