import { extForMime, sniffDocumentMime } from '../src/common/files/file-sniffer'

/** Реалистичные стартовые байты форматов. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)])
const HTML = Buffer.concat([Buffer.from('<html><script>alert(1)</script>'), Buffer.alloc(32)])
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)])

describe('P1 #12: KYC magic-byte sniffer (клиентский Content-Type не доверяем)', () => {
  it('распознаёт JPEG (FF D8 FF)', () => {
    expect(sniffDocumentMime(JPEG)).toBe('image/jpeg')
  })

  it('распознаёт PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
    expect(sniffDocumentMime(PNG)).toBe('image/png')
  })

  it('распознаёт WebP (RIFF....WEBP)', () => {
    expect(sniffDocumentMime(WEBP)).toBe('image/webp')
  })

  it('распознаёт PDF (%PDF-)', () => {
    expect(sniffDocumentMime(PDF)).toBe('application/pdf')
  })

  it('отклоняет не-документы: GIF, HTML/JS, ZIP, пустой буфер', () => {
    expect(sniffDocumentMime(GIF)).toBeNull()
    expect(sniffDocumentMime(HTML)).toBeNull()
    expect(sniffDocumentMime(ZIP)).toBeNull()
    expect(sniffDocumentMime(Buffer.alloc(0))).toBeNull()
  })

  it('короткие/обрезанные буферы не дают ложных срабатываний', () => {
    expect(sniffDocumentMime(Buffer.from([0xff, 0xd8]))).toBeNull() // JPEG без 3-го байта
    expect(sniffDocumentMime(Buffer.from('RIFFWEBP'))).toBeNull() // RIFF без 4 байт размера
    expect(sniffDocumentMime(Buffer.from('%PD'))).toBeNull()
  })

  it('sniff-тип выигрывает у клиентского Content-Type (PNG под видом JPEG)', () => {
    // клиент заявляет image/jpeg, байты — PNG: сниффер возвращает PNG,
    // контроллер пишет файл с расширением от sniffed-типа
    const sniffed = sniffDocumentMime(PNG)
    expect(sniffed).toBe('image/png')
    expect(extForMime(sniffed!)).toBe('.png')
  })

  it('extForMime: канонические расширения для всех разрешённых типов', () => {
    expect(extForMime('image/jpeg')).toBe('.jpg')
    expect(extForMime('image/png')).toBe('.png')
    expect(extForMime('image/webp')).toBe('.webp')
    expect(extForMime('application/pdf')).toBe('.pdf')
  })
})
