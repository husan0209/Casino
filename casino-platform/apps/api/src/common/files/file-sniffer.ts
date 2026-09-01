/**
 * Magic-byte sniffer для KYC-документов (P1 #12, SECURITY_FIXES).
 *
 * Клиентский Content-Type в multipart-запросе НЕ является фактом — его
 * тривиально подделать. Реальный тип файла определяется по сигнатуре
 * (magic bytes) первых байтов буфера.
 *
 * Строгая проверка префикса: PDF по спецификации начинается с '%PDF-'
 * (junk-префиксы вне спеки не принимаем). WebP: 'RIFF' + 4 любых байта
 * (размер) + 'WEBP'.
 */
export type AllowedDocumentMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

/** Отдельные сигнатурные проверки — каждая простой линейный тест (GAP-25 complexity). */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}
function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
}
function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
}
function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-'
}

export function sniffDocumentMime(buf: Buffer): AllowedDocumentMime | null {
  if (isJpeg(buf)) {
    return 'image/jpeg'
  }
  if (isPng(buf)) {
    return 'image/png'
  }
  if (isWebp(buf)) {
    return 'image/webp'
  }
  if (isPdf(buf)) {
    return 'application/pdf'
  }
  return null
}

/** Каноническое расширение для sniffed-типа (filename всегда uuid + ext). */
export function extForMime(mime: AllowedDocumentMime): string {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'application/pdf':
      return '.pdf'
  }
}
