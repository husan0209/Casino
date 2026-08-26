import { randomUUID } from 'crypto'
import { extname } from 'path'

import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors, UsePipes } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'

import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { GetMeUseCase } from '../../application/use-cases/get-me.use-case'
import { ListSessionsUseCase } from '../../application/use-cases/list-sessions.use-case'
import { RevokeSessionUseCase } from '../../application/use-cases/revoke-session.use-case'
import { SelfExclusionUseCase } from '../../application/use-cases/self-exclusion.use-case'
import { UpdateCurrencyPreferenceUseCase } from '../../application/use-cases/update-currency-preference.use-case'
import { UpdateProfileUseCase } from '../../application/use-cases/update-profile.use-case'
import { UpdateSettingsUseCase } from '../../application/use-cases/update-settings.use-case'
import { UpdateCurrencySchema } from '../dto/update-currency.dto'


@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private getMe: GetMeUseCase,
    private updateProfile: UpdateProfileUseCase,
    private updateSettings: UpdateSettingsUseCase,
    private listSessions: ListSessionsUseCase,
    private revokeSession: RevokeSessionUseCase,
    private selfExclusion: SelfExclusionUseCase,
    private updateCurrency: UpdateCurrencyPreferenceUseCase,
  ) {}

  @Get('me')
  me(@CurrentUser() user: any) { return this.getMe.execute(user.id) }

  @Patch('me/profile')
  updateProfileCtl(@CurrentUser() user: any, @Body() body: { first_name?: string; last_name?: string; date_of_birth?: string; country?: string; city?: string }) {
    return this.updateProfile.execute(user.id, body)
  }

  @Patch('me/settings')
  updateSettingsCtl(@CurrentUser() user: any, @Body() body: { language?: string; notifications_email?: boolean; notifications_sms?: boolean; notifications_push?: boolean; two_factor_enabled?: boolean }) {
    return this.updateSettings.execute(user.id, body)
  }

  @Patch('me/currency')
  @UsePipes(new ZodValidationPipe(UpdateCurrencySchema))
  setCurrency(@CurrentUser() user: any, @Body() body: { currency: string }) {
    return this.updateCurrency.execute(user.id, body.currency)
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/avatars',
      filename: (_, file, cb) => cb(null, randomUUID() + extname(file.originalname))
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => { const ok = /jpe?g|png|webp/.test(file.mimetype); cb(null, ok) }
  }))
  async avatar(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    // avatar url saving – simplified, reuse profile repo directly
    const { PrismaUserProfileRepository } = await import('../../infrastructure/repositories/user-profile.prisma')
    const repo = new PrismaUserProfileRepository()
    const url = `/uploads/avatars/${file.filename}`
    await repo.setAvatar(user.id, url)
    return { avatar_url: url }
  }

  /**
   * UC-RG-01 — Activate self-exclusion.
   * Body: { period_hours: number } — 0 = permanent, min 24
   */
  @Post('me/self-exclude')
  selfExclude(@CurrentUser() user: any, @Body() body: { period_hours: number }) {
    const hours = typeof body.period_hours === 'number' ? body.period_hours : 24
    return this.selfExclusion.exclude(user.id, hours)
  }

  /**
   * UC-RG-02 — Lift self-exclusion (subject to 72h cooloff from when exclusion was set).
   */
  @Delete('me/self-exclude')
  liftExclusion(@CurrentUser() user: any) {
    return this.selfExclusion.lift(user.id)
  }

  @Get('me/sessions')
  sessions(@CurrentUser() user: any) {
    return this.listSessions.execute(user.id, user.sessionId)
  }

  @Delete('me/sessions/:id')
  revoke(@CurrentUser() user: any, @Param('id') id: string) {
    return this.revokeSession.execute(user.id, id, user.sessionId)
  }
}
