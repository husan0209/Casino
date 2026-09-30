import { mkdirSync, writeFileSync } from 'fs'

import { vi } from 'vitest'

import { UploadKycDocumentUseCase } from '../src/modules/kyc/application/use-cases/upload-kyc-document.use-case'
import { KycFileError, KycNotSubmittedError } from '../src/modules/kyc/domain/errors'

import type { IKycRepository } from '../src/modules/kyc/domain/repositories/kyc.repository'

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('../src/common/files/file-sniffer', () => ({
  sniffDocumentMime: (buf: Buffer) => (buf.length > 3 ? 'image/jpeg' : null),
  extForMime: (mime: string) => `.${mime.split('/')[1]}`,
}))

function makeRepo(profileId: string | null) {
  const docs: unknown[] = []
  const repo = {
    getByUserId: async () => (profileId ? { id: profileId } : null),
    addDocument: async (id: string, doc: unknown) => {
      docs.push({ id, doc })
    },
  }
  return { repo: repo as unknown as IKycRepository, docs }
}

describe('UploadKycDocumentUseCase', () => {
  beforeEach(() => {
    vi.mocked(mkdirSync).mockClear()
    vi.mocked(writeFileSync).mockClear()
  })

  it('профиль не отправлен → KYC_NOT_SUBMITTED (400), ничего не пишется', async () => {
    const { repo } = makeRepo(null)
    const uc = new UploadKycDocumentUseCase(repo)
    const err = await uc
      .execute({
        userId: 'user-1',
        documentType: 'passport',
        file: { originalname: 'a.jpg', size: 10, buffer: Buffer.from('123456') },
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KycNotSubmittedError)
    expect((err as KycNotSubmittedError).httpStatus).toBe(400)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('пустой файл → KYC_FILE_INVALID «File is required»', async () => {
    const { repo } = makeRepo('kyc-1')
    const uc = new UploadKycDocumentUseCase(repo)
    await expect(
      uc.execute({
        userId: 'user-1',
        documentType: 'passport',
        file: { originalname: 'a.jpg', size: 0, buffer: Buffer.alloc(0) },
      }),
    ).rejects.toThrow('File is required')
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('magic bytes не распознаны → KYC_FILE_INVALID, на диск не пишем (P1 #12)', async () => {
    const { repo } = makeRepo('kyc-1')
    const uc = new UploadKycDocumentUseCase(repo)
    await expect(
      uc.execute({
        userId: 'user-1',
        documentType: 'passport',
        file: { originalname: 'a.exe', size: 2, buffer: Buffer.from('MZ') },
      }),
    ).rejects.toBeInstanceOf(KycFileError)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('валидный файл: имя генерируем сами, originalname санитизируется, документ привязан к профилю', async () => {
    const { repo, docs } = makeRepo('kyc-1')
    const uc = new UploadKycDocumentUseCase(repo)
    const res = await uc.execute({
      userId: 'user-1',
      documentType: 'passport',
      file: { originalname: '../../etc/passwd.jpg', size: 6, buffer: Buffer.from('123456') },
    })
    expect(res.ok).toBe(true)
    expect(res.file_url).toMatch(/^\/uploads\/kyc\/[0-9a-f-]{36}\.jpeg$/)
    expect(mkdirSync).toHaveBeenCalledWith('./uploads/kyc', { recursive: true })
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\/uploads\/kyc\/[0-9a-f-]{36}\.jpeg$/),
      Buffer.from('123456'),
      { mode: 0o600 },
    )
    expect(docs).toHaveLength(1)
    const { id, doc } = docs[0] as { id: string; doc: { fileName: string; mimeType: string } }
    expect(id).toBe('kyc-1')
    expect(doc.fileName).toBe('.._.._etc_passwd.jpg') // пути вырезаны
    expect(doc.mimeType).toBe('image/jpeg') // тип по magic bytes, не по Content-Type
  })
})
