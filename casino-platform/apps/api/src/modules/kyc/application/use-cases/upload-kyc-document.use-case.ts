import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'

import { Inject, Injectable } from '@nestjs/common'

import { extForMime, sniffDocumentMime } from '@/common/files/file-sniffer'

import { KycFileError, KycNotSubmittedError } from '../../domain/errors'
import { type IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'

const UPLOAD_DIR = './uploads/kyc'

/**
 * Приём KYC-документа (P1 #12): решение «писать/не писать» принимает use-case
 * ПОСЛЕ magic-byte проверки; недоверенный контент на диск не попадает,
 * расширение задаётся sniffed-типом (filename = randomUUID + ext).
 */
@Injectable()
export class UploadKycDocumentUseCase {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}

  async execute(input: {
    userId: string
    documentType: string
    file: { originalname: string; size: number; buffer: Buffer }
  }): Promise<{ ok: true; file_url: string }> {
    const profile = await this.repo.getByUserId(input.userId)
    if (!profile) {
      throw new KycNotSubmittedError()
    }
    if (input.file.buffer.length === 0) {
      throw new KycFileError('File is required')
    }
    // P1 #12: реальный тип — только по magic bytes, не по клиентскому Content-Type
    const sniffed = sniffDocumentMime(input.file.buffer)
    if (!sniffed) {
      throw new KycFileError('File content does not match an allowed document type')
    }
    // Пишем на диск только проверенный контент; имя генерируем сами.
    mkdirSync(UPLOAD_DIR, { recursive: true })
    const filename = randomUUID() + extForMime(sniffed)
    writeFileSync(`${UPLOAD_DIR}/${filename}`, input.file.buffer, { mode: 0o600 })
    const url = `/uploads/kyc/${filename}`
    // Sanitize originalName: strip any path components and limit length to prevent log/db bloat.
    const safeOriginal = input.file.originalname.replace(/[\\/]/g, '_').slice(0, 200)
    await this.repo.addDocument(profile.id, {
      documentType: input.documentType,
      fileUrl: url,
      fileName: safeOriginal,
      fileSize: input.file.size,
      mimeType: sniffed,
    })
    return { ok: true, file_url: url }
  }
}
