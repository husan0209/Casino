'use client'
import { useEffect, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

let items: ToastItem[] = []
const listeners = new Set<(v: ToastItem[]) => void>()
let nextId = 1

function emit(kind: ToastKind, message: string) {
  const item = { id: nextId++, kind, message }
  items = [...items, item]
  listeners.forEach((l) => l(items))
  setTimeout(() => {
    items = items.filter((t) => t.id !== item.id)
    listeners.forEach((l) => l(items))
  }, 4000)
}

export const toast = {
  success: (m: string) => emit('success', m),
  error: (m: string) => emit('error', m),
  info: (m: string) => emit('info', m),
}

/** Рендерится один раз в корневом layout. */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  if (!list.length) {
    return null
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl border px-4 py-2.5 text-sm shadow-lg ${
            t.kind === 'success'
              ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
              : t.kind === 'error'
                ? 'bg-red-950/90 border-red-700 text-red-200'
                : 'bg-[#141420] border-white/10 text-white'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
