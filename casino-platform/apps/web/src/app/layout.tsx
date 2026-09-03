import './globals.css'
import { MainShell } from '@/components/layout/MainShell'
import { Toaster } from '@/components/ui/toaster'

import { Providers } from './providers'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Casino',
  description: 'Mobile-first слоты для СНГ',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
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
