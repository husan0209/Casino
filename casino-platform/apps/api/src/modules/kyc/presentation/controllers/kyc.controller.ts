import { Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
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

@UseGuards(AuthGuard)
@Controller('kyc')
export class KycController {
  constructor(
    private submitUc: SubmitKycUseCase,
    private statusUc: GetKycStatusUseCase,
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
  ) {}
  @Get('status')
  status(@CurrentUser() u: any) { return this.statusUc.execute(u.id) }
  @Post('submit')
  submit(@CurrentUser() u: any, @Body() body: any) { return this.submitUc.execute({ userId: u.id, ...body }) }
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: './uploads/kyc', filename: (_, f, cb) => cb(null, randomUUID() + extname(f.originalname)) }),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  async upload(@CurrentUser() u: any, @Body() body: { document_type: string }, @UploadedFile() file: Express.Multer.File) {
    const profile = await this.repo.getByUserId(u.id)
    if (!profile) throw new Error('KYC_NOT_SUBMITTED')
    const url = `/uploads/kyc/${file.filename}`
    await this.repo.addDocument(profile.id, { documentType: body.document_type, fileUrl: url, fileName: file.originalname, fileSize: file.size, mimeType: file.mimetype })
    return { ok: true, file_url: url }
  }
}
