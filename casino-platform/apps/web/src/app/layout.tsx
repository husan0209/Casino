import './globals.css'
// ТЗ ч.5.1: единая фирменная типографика; cyrillic — обязательный сабсет.
// GAP-59 (п.3 аудита): Inter САМОХОСТИНГОЙ, а не next/font/google. Google Fonts
// тянет woff2 во время `next build` — сетевой отказ ронял сборку прод-образа web
// (воспроизведено локально: «next/font error: Failed to fetch Inter»).
// @fontsource-variable/inter кладёт файлы в бандл: latin/cyrillic + ось wght,
// font-display: swap — как у прежней конфигурации. Семейство 'Inter Variable'
// проброшено в --font-inter (globals.css), Tailwind по-прежнему берёт
// var(--font-inter) — вся типографика не изменилась.
import '@fontsource-variable/inter/wght.css'

import { AffiliateCodeCapture } from '@/components/affiliate/AffiliateCodeCapture'
import { MainShell } from '@/components/layout/MainShell'
import { Toaster } from '@/components/ui/toaster'

import { Providers } from './providers'

import type { Metadata, Viewport } from 'next'

/** ТЗ ч.5.1: единая фирменная типографика; cyrillic — обязательный сабсет. */

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
  width: 'device-width',
  initialScale: 1,
  // Mini App (GAP-21): WebView Telegram занимает окно целиком, вместе с «чёлкой»
  // и жестовой полосой. Без `cover` браузер считает safe-area нулями, и нижняя
  // навигация уходит под системный жест.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="ru">
      <body className="font-sans">
        <Providers>
          {/* Партнёрский код в localStorage — переживает ITP-усечение cookie */}
          <AffiliateCodeCapture />
          <MainShell>{children}</MainShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
