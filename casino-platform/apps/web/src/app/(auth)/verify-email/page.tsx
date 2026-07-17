'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import axios from 'axios'
import { useAuth } from '@/stores/auth'
import { setAccessToken } from '@/lib/api'
import { Suspense } from 'react'

function VerifyInner(){
  const sp = useSearchParams()
  const token = sp.get('token')
  const router = useRouter()
  const setAuth = useAuth(s=>s.setAuth)
  const [status, setStatus] = useState('Проверка…')
  useEffect(() => {
    if (!token) { setStatus('Нет токена'); return }
    axios.get((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1') + '/auth/verify-email?token=' + token)
      .then(r => {
        const d = r.data?.data || r.data
        if (d.accessToken) { setAuth(d.user, d.accessToken); setAccessToken(d.accessToken) }
        setStatus('Email подтверждён! Перенаправляем…')
        setTimeout(()=>router.push('/profile'), 1200)
      })
      .catch(e => setStatus('Ошибка: ' + (e?.response?.data?.error?.message || 'неверный токен')))
  }, [token])
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">{status}</div>
    </div>
  )
}
export default function VerifyEmailPage(){ return <Suspense><VerifyInner/></Suspense> }
