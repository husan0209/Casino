import './globals.css'
import type { Metadata } from 'next'
import { Providers } from './providers'
import { Header } from '@/components/layout/header'
import { Toaster } from '@/components/ui/toaster'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Casino — Premium', description: 'Online Casino Platform' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <Header />
          <main className="min-h-[70vh]">{children}</main>
          <footer className="border-t border-white/5 mt-16 py-10 text-sm text-muted">
            <div className="container-1 flex flex-col sm:flex-row justify-between gap-4">
              <div>© {new Date().getFullYear()} Casino — 18+ • <span className="text-muted/70">Rukassa • NOWPayments • KYC 5000₽</span></div>
              <div className="flex gap-4">
                <Link href="#">Условия</Link>
                <Link href="#">Конфиденциальность</Link>
                <Link href="#">Ответственная игра</Link>
              </div>
            </div>
          </footer>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
