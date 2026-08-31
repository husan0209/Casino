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

export function sniffDocumentMime(buf: Buffer): AllowedDocumentMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') {
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
