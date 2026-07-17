import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { GetMeUseCase } from '../../application/use-cases/get-me.use-case'
import { UpdateProfileUseCase } from '../../application/use-cases/update-profile.use-case'
import { UpdateSettingsUseCase } from '../../application/use-cases/update-settings.use-case'
import { ListSessionsUseCase } from '../../application/use-cases/list-sessions.use-case'
import { RevokeSessionUseCase } from '../../application/use-cases/revoke-session.use-case'
import { diskStorage } from 'multer'
import { extname } from 'path'
import { randomUUID } from 'crypto'

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private getMe: GetMeUseCase,
    private updateProfile: UpdateProfileUseCase,
    private updateSettings: UpdateSettingsUseCase,
    private listSessions: ListSessionsUseCase,
    private revokeSession: RevokeSessionUseCase,
  ) {}

  @Get('me')
  me(@CurrentUser() user: any) { return this.getMe.execute(user.id) }

  @Patch('me/profile')
  updateProfileCtl(@CurrentUser() user: any, @Body() body: any) {
    return this.updateProfile.execute(user.id, body)
  }

  @Patch('me/settings')
  updateSettingsCtl(@CurrentUser() user: any, @Body() body: any) {
    return this.updateSettings.execute(user.id, body)
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

  @Get('me/sessions')
  sessions(@CurrentUser() user: any) {
    return this.listSessions.execute(user.id, user.sessionId)
  }

  @Delete('me/sessions/:id')
  revoke(@CurrentUser() user: any, @Param('id') id: string) {
    return this.revokeSession.execute(user.id, id, user.sessionId)
  }
}
