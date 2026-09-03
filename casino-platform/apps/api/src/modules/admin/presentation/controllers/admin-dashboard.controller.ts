import { Controller, Get, Query, UseGuards } from '@nestjs/common'

import { DashboardService, DashPeriod } from '../../application/dashboard.service'
import { AdminAuthGuard } from '../admin-auth.guard'

@UseGuards(AdminAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private dashboard: DashboardService) {}

  // UC-ADMIN-DASH-01
  @Get('metrics')
  metrics(@Query('period') period?: DashPeriod): Promise<{ period: DashPeriod; users: { total: number; new_in_period: number; active_today: number; }; finance: { deposits: string; withdrawals: string; ggr: string; deposits_total: string; withdrawals_total: string; }; pending: { withdrawals: number; kyc: number; tickets: number; }; }> {
    return this.dashboard.metrics(period ?? 'today')
  }

  // UC-ADMIN-DASH-02
  @Get('charts')
  charts(@Query('period') period?: DashPeriod, @Query('type') type?: 'revenue' | 'registrations'): Promise<{ labels: string[]; datasets: { registrations: number[]; deposits?: never; withdrawals?: never; ggr?: never; }; } | { labels: string[]; datasets: { deposits: string[]; withdrawals: string[]; ggr: string[]; registrations?: never; }; }> {
    return this.dashboard.charts(
      period ?? '7d',
      type === 'registrations' ? 'registrations' : 'revenue',
    )
  }

  // UC-ADMIN-DASH-03
  @Get('events')
  events(@Query('limit') limit?: string): Promise<{ at: Date; type: string; detail: string; }[]> {
    return this.dashboard.events(parseInt(limit || '10', 10) || 10)
  }
}
