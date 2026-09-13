import './globals.css'
import { MainShell } from '@/components/layout/MainShell'
import { Toaster } from '@/components/ui/toaster'

import { Providers } from './providers'

import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'Casino — слоты онлайн',
    template: '%s | Casino',
  },
  description: 'Mobile-first слоты для СНГ',
  openGraph: {
    title: 'Casino — слоты онлайн',
    description: 'Mobile-first слоты для СНГ',
    type: 'website',
  },
}

/** Next 14: themeColor живёт в viewport, не в metadata (build-warning). */
export const viewport: Viewport = {
  themeColor: '#0F0F1A',
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
