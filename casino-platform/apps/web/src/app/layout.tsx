import './globals.css'
import { Inter } from 'next/font/google'

import { MainShell } from '@/components/layout/MainShell'
import { Toaster } from '@/components/ui/toaster'

import { Providers } from './providers'

import type { Metadata, Viewport } from 'next'

/** ТЗ ч.5.1: единая фирменная типографика; cyrillic — обязательный сабсет. */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

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
    <html lang="ru" className={inter.variable}>
      <body className="font-sans">
        <Providers>
          <MainShell>{children}</MainShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
