'use client'
import { type ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={`bg-[#141420] rounded-2xl border border-white/5 p-4 ${className}`}>
      {children}
    </div>
  )
}

export function PageTitle({ children }: { children: ReactNode }): React.JSX.Element {
  return <h1 className="text-xl font-bold mb-4">{children}</h1>
}

type BtnVariant = 'primary' | 'danger' | 'ghost' | 'ok'
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-[#ff3b7a] hover:bg-[#ff5588] text-white',
  ok: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  danger: 'bg-red-700 hover:bg-red-600 text-white',
  ghost: 'bg-white/5 hover:bg-white/10 text-white',
}
export function Btn({
  children,
  onClick,
  variant = 'primary',
  disabled,
  small,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: BtnVariant
  disabled?: boolean
  small?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg ${small ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} ${btnStyles[variant]} disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

export function Input({
  small,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { small?: boolean }): React.JSX.Element {
  return (
    <input
      {...props}
      className={`input ${small ? 'text-xs px-2 py-1' : ''} ${props.className ?? ''}`}
    />
  )
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select {...props} className="input">
      {children}
    </select>
  )
}

const badgeColors: Record<string, string> = {
  completed: 'bg-emerald-900/60 text-emerald-300',
  approved: 'bg-emerald-900/60 text-emerald-300',
  credited: 'bg-emerald-900/60 text-emerald-300',
  active: 'bg-emerald-900/60 text-emerald-300',
  pending: 'bg-yellow-900/60 text-yellow-300',
  in_progress: 'bg-blue-900/60 text-blue-300',
  cancelled: 'bg-zinc-700 text-zinc-300',
  closed: 'bg-zinc-700 text-zinc-300',
  blocked: 'bg-red-900/60 text-red-300',
  rejected: 'bg-red-900/60 text-red-300',
  failed: 'bg-red-900/60 text-red-300',
  expired: 'bg-zinc-700 text-zinc-300',
  open: 'bg-sky-900/60 text-sky-300',
  waiting_user: 'bg-purple-900/60 text-purple-300',
}
export function Badge({ value }: { value: string }): React.JSX.Element {
  const cls = badgeColors[value] ?? 'bg-white/10 text-white'
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${cls}`}>{value}</span>
}

export function Pager({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number
  perPage: number
  total: number
  onPage: (p: number) => void
}): React.JSX.Element {
  const pages = Math.max(1, Math.ceil(total / perPage))
  return (
    <div className="flex items-center gap-3 mt-3 text-sm text-[#8b8ba7]">
      <Btn small variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Назад
      </Btn>
      <span>
        {page} / {pages} · всего {total}
      </span>
      <Btn small variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Вперёд →
      </Btn>
    </div>
  )
}

export function ErrorBox({ msg }: { msg?: string | undefined }): React.JSX.Element | null {
  if (!msg) {
    return null
  }
  return (
    <div className="mb-3 rounded-lg bg-red-950/70 border border-red-800 px-3 py-2 text-sm text-red-300">
      {msg}
    </div>
  )
}

export function Loading(): React.JSX.Element {
  return <div className="text-sm text-[#8b8ba7] py-6">Загрузка…</div>
}

export function Th({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <th className="text-left text-xs uppercase tracking-wide text-[#8b8ba7] px-3 py-2 border-b border-white/10">
      {children}
    </th>
  )
}
export function Td({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <td className={`px-3 py-2 border-b border-white/5 align-top ${className}`}>{children}</td>
}
