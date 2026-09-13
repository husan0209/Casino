import type { Metadata } from 'next'

/** GAP-52 (ТЗ ч.5 §20): приватный раздел — noindex. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function SectionLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children as React.JSX.Element
}
