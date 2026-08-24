import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../admin-auth.guard'
import { DashboardService, DashPeriod } from '../../application/dashboard.service'

@UseGuards(AdminAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private dashboard: DashboardService) {}

  // UC-ADMIN-DASH-01
  @Get('metrics')
  metrics(@Query('period') period?: DashPeriod) {
    return this.dashboard.metrics(period ?? 'today')
  }

  // UC-ADMIN-DASH-02
  @Get('charts')
  charts(@Query('period') period?: DashPeriod, @Query('type') type?: 'revenue' | 'registrations') {
    return this.dashboard.charts(period ?? '7d', type === 'registrations' ? 'registrations' : 'revenue')
  }

  // UC-ADMIN-DASH-03
  @Get('events')
  events(@Query('limit') limit?: string) {
    return this.dashboard.events(parseInt(limit || '10', 10) || 10)
  }
}
