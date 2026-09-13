import type { Metadata } from 'next'

/**
 * GAP-52 (ТЗ ч.5 §20): приватные разделы — noindex (кошелёк, история,
 * профиль, KYC, поддержка, рефералка, избранное, поиск по аккаунту).
 * robots здесь — серверный layout; клиентские страницы не трогаем.
 */
export const metadata: Metadata = {
  title: 'Личный кабинет',
  robots: { index: false, follow: false },
}

export default function ProfileLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children as React.JSX.Element
}
