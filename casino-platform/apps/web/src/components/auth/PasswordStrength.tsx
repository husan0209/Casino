'use client'

/**
 * Индикатор силы пароля. Живёт отдельно от `LoginSheet`, потому что поле нового
 * пароля есть не только в шторке входа: сброс по ссылке из письма — то же
 * требование к паролю, и показывать его надо одинаково. Две копии шкалы
 * разъехались бы при первой же правке правила.
 *
 * §5.1: в шторке это замена полю «подтвердите пароль» — при видимости по кнопке
 * «глаз» и живой шкале повтор не добавляет точности, а стоит лишний экран
 * ввода. На странице сброса поля два: там пароля-предыдущего нет, и опечатка
 * означала бы «задал пароль, которого не знаешь» уже после того, как ссылка
 * сброса сожжена.
 */

export function getStrength(pass: string): { label: string; score: number; color: string } {
  if (!pass) {
    return { label: '', score: 0, color: 'bg-transparent' }
  }
  let score = 0
  if (pass.length >= 8) {
    score++
  }
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) {
    score++
  }
  if (/[0-9]/.test(pass)) {
    score++
  }
  if (/[^A-Za-z0-9]/.test(pass)) {
    score++
  }

  if (score <= 1) {
    return { label: 'Слабый пароль', score: 1, color: 'bg-[#FF3D71]' }
  }
  if (score <= 2) {
    return { label: 'Средний пароль', score: 2, color: 'bg-[#FFB300]' }
  }
  return { label: 'Надёжный пароль', score: 3, color: 'bg-money' }
}

export function PasswordStrengthMeter({
  password,
}: {
  password: string
}): React.JSX.Element | null {
  if (password === '') {
    return null
  }
  const strength = getStrength(password)
  return (
    <div className="mt-1.5 space-y-1" data-testid="password-strength">
      <div className="flex h-1 gap-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full flex-1 ${strength.score >= 1 ? strength.color : 'opacity-20'}`} />
        <div className={`h-full flex-1 ${strength.score >= 2 ? strength.color : 'opacity-20'}`} />
        <div className={`h-full flex-1 ${strength.score >= 3 ? strength.color : 'opacity-20'}`} />
      </div>
      <div className="text-[10px] text-muted">{strength.label}</div>
    </div>
  )
}
