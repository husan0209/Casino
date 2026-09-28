/**
 * Script-style ambient declaration для 'multer'.
 * Отдельный файл без import/export — иначе ambient-модуль не подхватывается.
 * Временная мера до `pnpm add -D @types/multer` (см. IMPLEMENTATION_GAPS → Environment;
 * переезд нетривиален: buffer в реальных типах опционален, а аугментация
 * Express.Request.cookies в multer.d.ts конфликтует с @types/express — см. TECH_DEBT В10).
 * Колбэки StorageEngineOptions типизированы unknown: диск-storage в коде не
 * используется (только memoryStorage), поверхности для contravariance-ошибок нет.
 */
declare module 'multer' {
  type MulterCallback<T> = (error: Error | null, value?: T) => void
  interface StorageEngineOptions {
    destination?: string | ((req: unknown, file: unknown, cb: MulterCallback<string>) => void)
    filename?: (req: unknown, file: unknown, cb: MulterCallback<string>) => void
  }
  function diskStorage(options: StorageEngineOptions): unknown
  function memoryStorage(): unknown
}
