import './globals.css'
import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/toaster'
import { Providers } from './providers'
import { MainShell } from '@/components/layout/MainShell'

export const metadata: Metadata = {
  title: 'Casino',
  description: 'Mobile-first слоты для СНГ',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <MainShell>{children}</MainShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
