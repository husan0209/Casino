import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'

import { Inject, Injectable } from '@nestjs/common'

import { type AllowedDocumentMime, extForMime } from '@/common/files/file-sniffer'

import {
  USER_PROFILE_REPOSITORY,
  type IUserProfileRepository,
} from '../../domain/repositories/user-profile.repository'

const AVATAR_DIR = './uploads/avatars'

/**
 * В3 (users): сохранение аватара — БД-запись только через порт.
 *
 * Раньше контроллер сам делал `await import('…/user-profile.prisma.js')`,
 * строил репозиторий конструктором и звал `setAvatar` — то есть presentation
 * в обход DI и слоёв писал в БД (гард G16, AI_DEVELOPMENT_RULES §3.2). Теперь
 * application решает «как храним», infrastructure (репозиторий) — «куда пишем».
 *
 * Проверки формы multipart-запроса (пустой буфер, не-картинка по magic bytes)
 * остаются в контроллере: их 400-ответы заморожены HTTP-контрактом и базлайном
 * tech-debt/nest-exceptions (перевод в AppError — отдельная волна G17).
 */
@Injectable()
export class SetAvatarUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private readonly profiles: IUserProfileRepository) {}

  async execute(input: {
    userId: string
    buffer: Buffer
    mimeType: AllowedDocumentMime
  }): Promise<{ avatar_url: string }> {
    // Имя генерируем сами: расширение — из sniffed-типа, а не из originalname
    // запроса (P1 #12), путь пользователя не попадает в ФС.
    mkdirSync(AVATAR_DIR, { recursive: true })
    const filename = randomUUID() + extForMime(input.mimeType)
    writeFileSync(`${AVATAR_DIR}/${filename}`, input.buffer, { mode: 0o600 })
    const avatarUrl = `/uploads/avatars/${filename}`
    await this.profiles.setAvatar(input.userId, avatarUrl)
    return { avatar_url: avatarUrl }
  }
}
