import Link from 'next/link'
const nav = [
  ['Дашборд','/dashboard'],
  ['Пользователи','/dashboard/users'],
  ['Транзакции','/dashboard/transactions'],
  ['Платежи','/dashboard/payments'],
  ['Выводы','/dashboard/withdrawals'],
  ['KYC','/dashboard/kyc'],
  ['Игры','/dashboard/games'],
  ['Провайдеры','/dashboard/providers'],
  ['Поддержка','/dashboard/support'],
  ['Рефералы','/dashboard/referrals'],
  ['Аудит','/dashboard/audit'],
  ['Админы','/dashboard/admins'],
  ['Настройки','/dashboard/settings'],
]
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b0b12] text-white">
      <header className="h-14 border-b border-white/10 bg-[#141420] flex items-center px-4 justify-between">
        <div className="font-bold">ADMIN<span className="text-[#ff3b7a]">.</span></div>
        <div className="text-sm text-[#8b8ba7]">superadmin@casino.example.com</div>
      </header>
      <div className="flex">
        <aside className="w-60 border-r border-white/10 min-h-[calc(100vh-56px)] p-3">
          <nav className="space-y-1 text-sm">
            {nav.map(([l,h])=><Link key={h} href={h} className="block px-3 py-2 rounded-lg hover:bg-white/5">{l}</Link>)}
          </nav>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
