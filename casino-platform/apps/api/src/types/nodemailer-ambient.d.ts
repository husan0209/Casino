/**
 * Ambient declaration для 'nodemailer' (optional peer, типы недоступны в оффлайн-store).
 * Удалить после `pnpm add nodemailer @types/nodemailer` на боевой Linux-FS.
 */
declare module 'nodemailer' {
  interface Transport {
    sendMail(options: Record<string, unknown>): Promise<unknown>
  }
  interface TransportOptions {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; pass: string }
  }
  function createTransport(options: TransportOptions): Transport
  const nodemailer: { createTransport: typeof createTransport }
  export = nodemailer
}
