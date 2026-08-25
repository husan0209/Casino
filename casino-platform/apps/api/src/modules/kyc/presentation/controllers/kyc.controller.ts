import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname } from 'path'
import { randomUUID } from 'crypto'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { SubmitKycUseCase } from '../../application/use-cases/submit-kyc.use-case'
import { GetKycStatusUseCase } from '../../application/use-cases/get-kyc-status.use-case'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { Inject } from '@nestjs/common'

// SECURITY_BASELINE.md §7.1 — KYC documents whitelist.
// MIME type and extension MUST both be in the allowed lists.
// Filename is always randomUUID + allowed extension; original name is discarded.
const ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])
const ALLOWED_EXT = new Set<string>(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function pickExtension(mimetype: string, originalName: string): string {
  // Trust MIME first, fall back to original extension only if MIME matches.
  if (mimetype === 'image/jpeg') return '.jpg'
  if (mimetype === 'image/png') return '.png'
  if (mimetype === 'image/webp') return '.webp'
  if (mimetype === 'application/pdf') return '.pdf'
  const ext = extname(originalName).toLowerCase()
  return ALLOWED_EXT.has(ext) ? ext : ''
}

@UseGuards(AuthGuard)
@Controller('kyc')
export class KycController {
  constructor(
    private submitUc: SubmitKycUseCase,
    private statusUc: GetKycStatusUseCase,
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
  ) {}
  @Get('status')
  status(@CurrentUser() u: any, @Query('currency') currency?: string) {
    return this.statusUc.execute(u.id, currency || 'RUB')
  }
  @Post('submit')
  submit(@CurrentUser() u: any, @Body() body: any) { return this.submitUc.execute({ userId: u.id, ...body }) }
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/kyc',
      filename: (_, f, cb) => {
        const ext = pickExtension(f.mimetype, f.originalname)
        if (!ext) return cb(new BadRequestException('Unsupported file type'), '')
        cb(null, randomUUID() + ext)
      },
    }),
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    fileFilter: (_, f, cb) => {
      if (!ALLOWED_MIME.has(f.mimetype)) {
        return cb(new BadRequestException(`Unsupported MIME type: ${f.mimetype}`), false)
      }
      const ext = extname(f.originalname).toLowerCase()
      // Allow upload even if extension is empty (e.g. mobile camera) — pickExtension will normalize.
      if (ext && !ALLOWED_EXT.has(ext)) {
        return cb(new BadRequestException(`Unsupported file extension: ${ext}`), false)
      }
      cb(null, true)
    },
  }))
  async upload(@CurrentUser() u: any, @Body() body: { document_type: string }, @UploadedFile() file: Express.Multer.File) {
    const profile = await this.repo.getByUserId(u.id)
    if (!profile) throw new Error('KYC_NOT_SUBMITTED')
    const url = `/uploads/kyc/${file.filename}`
    // Sanitize originalName: strip any path components and limit length to prevent log/db bloat.
    const safeOriginal = file.originalname.replace(/[\\/]/g, '_').slice(0, 200)
    await this.repo.addDocument(profile.id, { documentType: body.document_type, fileUrl: url, fileName: safeOriginal, fileSize: file.size, mimeType: file.mimetype })
    return { ok: true, file_url: url }
  }
}
