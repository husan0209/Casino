/**
 * Админ-вход отдельным модулем: `AdminAuthService` (проверка пароля и выпуск
 * JWT с aud='admin') + `AdminAuthGuard`.
 *
 * Зачем вынесено из `AdminModule`. `KycModule` импортировал AdminModule ради
 * одного гварда, и из-за этого любая попытка admin импортировать чужой модуль
 * собирала цикл: `admin → payments → kyc → admin` (payments нужен kyc для
 * порога депозитов, kyc — admin для гварда). eslint `import/no-cycle` ловит
 * цикл статически, поэтому долг `cross-module-imports` в admin был
 * незакрываемым, пока зависимость от гварда не перестала идти через весь
 * AdminModule.
 *
 * Классы на месте не переезжали — переехала только их регистрация, поэтому
 * импорты `AdminAuthGuard`/`AdminAuthService` в контроллерах не менялись.
 *
 * ConfigService не импортируется: он глобальный (AppModule), как и в
 * AdminModule, где эти провайдеры жили раньше.
 */
import { Module } from '@nestjs/common'

import { AdminAuthService } from './infrastructure/admin-jwt.service'
import { AdminAuthGuard } from './presentation/admin-auth.guard'

@Module({
  providers: [AdminAuthService, AdminAuthGuard],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
