/**
 * Временная ambient-декларация multer.
 * Заменяет отсутствующий @types/multer (нет доступа к registry в этой среде —
 * см. docs/IMPLEMENTATION_GAPS.md, раздел Environment).
 * Покрывает только реально используемые поля: diskStorage + Express.Multer.File.
 * НА продакшн-машине: pnpm add -D @types/multer и удалить этот файл.
 */
export {}

declare global {
  namespace Express {
    /** request-id: ставится pino genReqId (logger.options.ts) и RequestIdMiddleware. */
    interface Request {
      id?: string
      /** cookie-parser: типизируем вместо express `cookies: any` (GAP-39). */
      cookies: Record<string, string | undefined>
    }
    namespace Multer {
      interface File {
        fieldname: string
        originalname: string
        encoding: string
        mimetype: string
        size: number
        destination: string
        filename: string
        path: string
        buffer: Buffer
      }
    }
  }
}
