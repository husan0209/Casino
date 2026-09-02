/**
 * Script-style ambient declaration для 'multer'.
 * Отдельный файл без import/export — иначе ambient-модуль не подхватывается.
 * Временная мера до `pnpm add -D @types/multer` (см. IMPLEMENTATION_GAPS → Environment).
 */
declare module 'multer' {
  type MulterCallback<T> = (error: Error | null, value?: T) => void
  interface StorageEngineOptions {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ambient multer shim (GAP-01): @types/multer недоступен в оффлайн-среде
    destination?: string | ((req: any, file: any, cb: MulterCallback<string>) => void)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ambient multer shim (GAP-01)
    filename?: (req: any, file: any, cb: MulterCallback<string>) => void
  }
  function diskStorage(options: StorageEngineOptions): unknown
  function memoryStorage(): unknown
}
