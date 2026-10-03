'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

/**
 * Поле пароля: в правом углу кнопка «показать / скрыть», а не декоративная
 * иконка (ТЗ ч.5.1 §6 — иконка в поле обязана быть управляемой). Видимость
 * живёт в самом поле: это состояние ввода, а не данных, в стор её не тащим.
 */
export function PasswordField({
  className = '',
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        {...inputProps}
        type={visible ? 'text' : 'password'}
        className={`input pr-10 ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-white"
      >
        {visible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
      </button>
    </div>
  )
}
