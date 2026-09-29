import { extname } from 'path'

import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { UploadKycDocumentUseCase } from '@modules/kyc/application/use-cases/upload-kyc-document.use-case'
import { KycFileError } from '@modules/kyc/domain/errors'

import { type DisplayCurrency } from '@casino/shared-config'
import { type KycProfileRow } from '@casino/shared-types'

import { GetKycStatusUseCase } from '../../application/use-cases/get-kyc-status.use-case'
import { SubmitKycUseCase } from '../../application/use-cases/submit-kyc.use-case'
import { KycDocumentTypeSchema, SubmitKycSchema } from '../dto/kyc.dto'

// SECURITY_BASELINE.md §7.1 — KYC documents whitelist.
// P1 #12: MIME-фильтр Multer'а — только первая линия; клиентский Content-Type
// подделывается тривиально. Финальное решение — magic bytes (file-sniffer),
// они в UploadKycDocumentUseCase: файл пишется на диск ТОЛЬКО после проверки
// сигнатуры (В3: запись/проверка — application, контроллер тонкий).
const ALLOWED_EXT = new Set<string>(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

@UseGuards(AuthGuard)
@Controller('kyc')
export class KycController {
  constructor(
    private submitUc: SubmitKycUseCase,
    private statusUc: GetKycStatusUseCase,
    private uploadUc: UploadKycDocumentUseCase,
  ) {}
  @Get('status')
  status(
    @CurrentUser() u: UserActor,
    @Query('currency') currency?: string,
  ): Promise<{
    deposit_limit_rub: string
    total_deposited_rub: string
    limit_remaining: string
    limit_currency: DisplayCurrency
    status?: string
    submittedAt?: Date | null
    rejectionReason?: string | null
    documents?: string[]
  }> {
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
      // P1 #12: память, не диск — решение «писать/не писать» принимает use-case
      // ПОСЛЕ magic-byte проверки; недоверенный контент на диск не попадает.
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
      // грубый пре-фильтр: отсеивает заведомо чужие типы до сниффера
      fileFilter: (_, f, cb) => {
        const ext = extname(f.originalname).toLowerCase()
        if (ext && !ALLOWED_EXT.has(ext)) {
          return cb(new KycFileError(`Unsupported file extension: ${ext}`), false)
        }
        cb(null, true)
      },
    }),
  )
  upload(
    @CurrentUser() u: UserActor,
    @Body(new ZodValidationPipe(KycDocumentTypeSchema)) body: { document_type: string },
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ ok: boolean; file_url: string }> {
    return this.uploadUc.execute({
      userId: u.id,
      documentType: body.document_type,
      file: { originalname: file.originalname, size: file.size, buffer: file.buffer },
    })
  }
}
