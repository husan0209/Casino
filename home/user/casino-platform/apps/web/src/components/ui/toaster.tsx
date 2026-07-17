'use client'
import { create } from 'zustand'
type Toast = { id: number; msg: string; type?: 'ok'|'err' }
const useToastStore = create<{ toasts: Toast[]; push: (msg: string, type?: 'ok'|'err') => void; remove: (id: number) => void }>((set) => ({
  toasts: [],
  push: (msg, type) => set(s => ({ toasts: [...s.toasts, { id: Date.now()+Math.random(), msg, type }]})),
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
export const toast = { success: (m:string)=> useToastStore.getState().push(m,'ok'), error: (m:string)=> useToastStore.getState().push(m,'err') }
export function Toaster() {
  const { toasts, remove } = useToastStore()
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2">
      {toasts.map(t => (
        <div key={t.id} onClick={()=>remove(t.id)}
          className={`px-4 py-2 rounded-xl shadow-lg text-sm cursor-pointer ${t.type==='err' ? 'bg-red-600' : 'bg-zinc-800'} text-white`}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
// auto-dismiss
if (typeof window !== 'undefined') {
  setInterval(() => {
    const s = useToastStore.getState()
    if (s.toasts.length) s.remove(s.toasts[0].id)
  }, 3500)
}
