import { randomUUID } from 'crypto'
import { DisplayCurrency } from '@casino/shared-config'
import { KycProfileRow } from '@modules/kyc/domain/repositories/kyc.repository'
import { mkdirSync, writeFileSync } from 'fs'
import { extname } from 'path'

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  Inject,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { extForMime, sniffDocumentMime } from '@/common/files/file-sniffer'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'

import { GetKycStatusUseCase } from '../../application/use-cases/get-kyc-status.use-case'
import { SubmitKycUseCase } from '../../application/use-cases/submit-kyc.use-case'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import {
  KycDocumentTypeSchema,
  SubmitKycSchema,
} from '../dto/kyc.dto'

// SECURITY_BASELINE.md §7.1 — KYC documents whitelist.
// P1 #12: MIME-фильтр Multer'а — только первая линия; клиентский Content-Type
// подделывается тривиально. Финальное решение — magic bytes (file-sniffer):
// файл пишется на диск ТОЛЬКО после проверки сигнатуры, расширение задаётся
// sniffed-типом (filename = randomUUID + ext), имя всегда безопасно.
const ALLOWED_EXT = new Set<string>(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const UPLOAD_DIR = './uploads/kyc'

@UseGuards(AuthGuard)
@Controller('kyc')
export class KycController {
  constructor(
    private submitUc: SubmitKycUseCase,
    private statusUc: GetKycStatusUseCase,
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
  ) {}
  @Get('status')
  status(@CurrentUser() u: UserActor, @Query('currency') currency?: string): Promise<{ deposit_limit_rub: string; total_deposited_rub: string; limit_remaining: string; limit_currency: DisplayCurrency; status?: string; submittedAt?: Date | null; rejectionReason?: string | null; documents?: string[]; }> {
    return this.statusUc.execute(u.id, currency || 'RUB')
  }
  @Post('submit')
  @UsePipes(new ZodValidationPipe(SubmitKycSchema))
  submit(
    @CurrentUser() u: UserActor,
    @Body()
    body: {
      first_name: string
      last_name: string
      date_of_birth: string
      country: string
      document_type: string
      document_number: string
      document_expiry?: string
    },
  ): Promise<KycProfileRow> {
    return this.submitUc.execute({ userId: u.id, ...body })
  }
  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      // P1 #12: память, не диск — решение «писать/не писать» принимает контроллер
      // ПОСЛЕ magic-byte проверки; недоверенный контент на диск не попадает.
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
      // грубый пре-фильтр: отсеивает заведомо чужие типы до сниффера
      fileFilter: (_, f, cb) => {
        const ext = extname(f.originalname).toLowerCase()
        if (ext && !ALLOWED_EXT.has(ext)) {
          return cb(new BadRequestException(`Unsupported file extension: ${ext}`), false)
        }
        cb(null, true)
      },
    }),
  )
  async upload(
    @CurrentUser() u: UserActor,
    @Body(new ZodValidationPipe(KycDocumentTypeSchema)) body: { document_type: string },
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ ok: boolean; file_url: string; }> {
    const profile = await this.repo.getByUserId(u.id)
    if (!profile) {
      throw new Error('KYC_NOT_SUBMITTED')
    }
    if (file.buffer.length === 0) {
      throw new BadRequestException('File is required')
    }
    // P1 #12: реальный тип — только по magic bytes, не по клиентскому Content-Type
    const sniffed = sniffDocumentMime(file.buffer)
    if (!sniffed) {
      throw new BadRequestException('File content does not match an allowed document type')
    }
    // Пишем на диск только проверенный контент; имя генерируем сами.
    mkdirSync(UPLOAD_DIR, { recursive: true })
    const filename = randomUUID() + extForMime(sniffed)
    writeFileSync(`${UPLOAD_DIR}/${filename}`, file.buffer, { mode: 0o600 })
    const url = `/uploads/kyc/${filename}`
    // Sanitize originalName: strip any path components and limit length to prevent log/db bloat.
    const safeOriginal = file.originalname.replace(/[\\/]/g, '_').slice(0, 200)
    await this.repo.addDocument(profile.id, {
      documentType: body.document_type,
      fileUrl: url,
      fileName: safeOriginal,
      fileSize: file.size,
      mimeType: sniffed,
    })
    return { ok: true, file_url: url }
  }
}
