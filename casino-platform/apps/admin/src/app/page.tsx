import Link from 'next/link'
export default function Login(){ return (
  <div className="min-h-screen flex items-center justify-center bg-[#0b0b12]">
    <div className="w-full max-w-sm bg-[#141420] border border-white/10 rounded-2xl p-6">
      <h1 className="text-xl font-bold mb-4">Admin Panel</h1>
      <p className="text-sm text-[#8b8ba7] mb-4">Авторизация администратора — будет в Части 2.</p>
      <Link href="/dashboard" className="w-full inline-flex justify-center bg-[#ff3b7a] rounded-xl py-2.5">Войти (dev)</Link>
    </div>
  </div>
)}
