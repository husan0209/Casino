'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { PasswordStrengthMeter } from '@/components/auth/PasswordStrength'
import { PasswordField } from '@/components/ui/password-field'
import { toast } from '@/components/ui/toaster'
import {
  affiliateErrText,
  affiliateGet,
  affiliatePatch,
  affiliatePost,
  affiliatePasswordErrText,
} from '@/lib/affiliate-api'
import { formatAmount, formatRate } from '@/lib/affiliate-format'
import {
  AFFILIATE_PASSWORD_TOO_SHORT_TEXT,
  affiliatePasswordProblem,
} from '@/lib/ui/affiliate-password'
import { type AffiliateAuthState, useAffiliateAuth } from '@/stores/affiliate'
import { type AffiliateMeDto } from '@/types/affiliate'

/**
 * Настройки партнёра.
 *
 * Ставку здесь изменить НЕЛЬЗЯ — только админ. Это осознанно: ставка влияет на
 * P&L, и «партнёр сам себе поднял процент» — прямой финансовый риск. Партнёр
 * видит текущую ставку и может запросить пересмотр через поддержку.
 */
export default function AffiliateSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [website, setWebsite] = useState('')
  const [telegram, setTelegram] = useState('')
  const [leaving, setLeaving] = useState(false)

  const me = useQuery({
    queryKey: ['aff-me'],
    queryFn: () => affiliateGet<AffiliateMeDto>('/affiliate/me'),
  })

  // Заполняем поля только один раз: перезапись формы после каждого рефетча
  // сбрасывала бы правки пользователя.
  useEffect(() => {
    if (me.data === undefined) {
      return
    }
    setDisplayName(me.data.display_name ?? '')
    setWebsite('')
    setTelegram('')
  }, [me.data])

  const save = useMutation({
    mutationFn: () =>
      affiliatePatch<unknown>('/affiliate/me', {
        display_name: displayName.trim() === '' ? null : displayName.trim(),
        website: website.trim() === '' ? null : website.trim(),
        telegram: telegram.trim() === '' ? null : telegram.trim(),
      }),
    onSuccess: () => {
      toast.success('Сохранено')
      void queryClient.invalidateQueries({ queryKey: ['aff-me'] })
    },
    onError: (err: unknown) => toast.error(affiliateErrText(err)),
  })

  const leave = useMutation({
    mutationFn: () => affiliatePost<unknown>('/affiliate/leave'),
    onSuccess: () => {
      toast.success('Вы вышли из партнёрской программы')
      void queryClient.invalidateQueries({ queryKey: ['aff-me'] })
    },
    onError: (err: unknown) => toast.error(affiliateErrText(err)),
  })

  if (me.data === undefined) {
    return <div className="text-muted text-sm py-6">Загрузка…</div>
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="text-muted text-sm">Ставка RevShare</div>
        <div className="text-2xl font-black text-money-dark mt-1">
          {formatRate(me.data.revshare_rate)}
        </div>
        <div className="text-muted text-xs mt-2">
          Ставку устанавливает оператор. Запросить пересмотр можно через поддержку — с указанием
          ожидаемого объёма трафика.
        </div>
        <div className="text-muted text-xs mt-1">
          Условия программы, версия {me.data.terms_version}
          {me.data.is_agreed ? ' · приняты' : ' · не приняты'}
        </div>
      </div>

      <div className="card">
        <div className="text-muted text-sm mb-1">Заработано и баланс</div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <div className="text-muted text-xs">Всего начислено</div>
            <div className="text-lg font-bold font-mono">
              {formatAmount(me.data.total_earned, me.data.payout_currency)}
            </div>
          </div>
          <div>
            <div className="text-muted text-xs">Баланс кошелька</div>
            <div className="text-lg font-bold font-mono text-money-dark">
              {formatAmount(me.data.balance.RUB, 'RUB')}
            </div>
          </div>
        </div>
        <div className="text-muted text-xs mt-3">
          Вывод доступен через обычную кассу казино. Для вывода свыше 5000 ₽ требуется
          подтверждённый KYC.
        </div>
      </div>

      <div className="card">
        <div className="font-semibold mb-3">Контакты и источник трафика</div>
        <div className="space-y-3">
          <div>
            <label className="field-label" htmlFor="s-name">
              Имя в кабинете
            </label>
            <input
              id="s-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={128}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="s-site">
              Сайт или канал
            </label>
            <input
              id="s-site"
              className="input"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
            />
            <div className="text-muted text-xs mt-1">
              Проверяется вручную при выплатах — указывайте реальный источник трафика.
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="s-tg">
              Telegram для связи
            </label>
            <input
              id="s-tg"
              className="input"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="@username"
            />
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn">
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>

      <ChangePasswordCard />

      <div className="card border-[#FF3D71]/30">
        <div className="font-semibold text-[#FF3D71] mb-1">Выход из программы</div>
        <div className="text-muted text-sm mb-3">
          Партнёрский аккаунт перейдёт в статус «приостановлен»: ссылка перестанет атрибутировать
          трафик. Накопленная статистика и уже начисленные средства сохранятся — вернуться можно в
          любой момент.
        </div>
        {leaving ? (
          <div className="flex gap-2">
            <button onClick={() => leave.mutate()} disabled={leave.isPending} className="btn">
              {leave.isPending ? 'Выходим…' : 'Да, выйти'}
            </button>
            <button onClick={() => setLeaving(false)} className="btn-ghost text-sm">
              Отмена
            </button>
          </div>
        ) : (
          <button onClick={() => setLeaving(true)} className="btn-ghost text-sm">
            Выйти из партнёрской программы
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Смена пароля партнёра внутри живущей сессии.
 *
 * Блок отделён от формы контактов не для красоты: контакты идут через
 * PATCH /affiliate/me и сессия остаётся живой, а POST /affiliate/me/password
 * закрывает ВСЕ партнёрские сессии. Поэтому после успеха локальная сессия
 * гасится (это делает store — см. stores/affiliate.changePassword) и партнёр
 * уходит на вход: остаться в кабинете с мёртвым токеном было бы хуже, чем
 * принудительный logout.
 *
 * Поле «повтор» живёт только здесь: тело запроса — ровно два поля (схема на API
 * `.strict()`), и третье попасть в него не должно.
 */
function ChangePasswordCard(): React.JSX.Element {
  const router = useRouter()
  const changePassword = useAffiliateAuth((state: AffiliateAuthState) => state.changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const passwordChange = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success('Пароль изменён')
      router.replace('/affiliate/login')
    },
    onError: (err: unknown) => {
      setError(affiliatePasswordErrText(err))
    },
  })

  function submit(): void {
    // Пустой текущий пароль отсекаем здесь: иначе сервер ответил бы
    // «Текущий пароль указан неверно», что про поля формы было бы неправдой.
    if (currentPassword === '') {
      setHint('Введите текущий пароль')
      setError(null)
      return
    }
    const problem = affiliatePasswordProblem(newPassword, repeatPassword)
    if (problem !== null) {
      setHint(problem)
      setError(null)
      return
    }
    setHint(null)
    setError(null)
    passwordChange.mutate()
  }

  return (
    <div className="card">
      <div className="font-semibold mb-1">Смена пароля</div>
      <div className="text-muted text-xs mb-3">
        После смены пароля закрываются все активные сессии партнёра — во всех браузерах. Войти нужно
        будет заново.
      </div>

      {error !== null && (
        <div className="mb-3 rounded-xl border border-[#FF3D71]/40 p-3">
          <div className="text-[#FF3D71] text-sm" role="alert">
            {error}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="field-label" htmlFor="s-pass-current">
            Текущий пароль
          </label>
          <PasswordField
            id="s-pass-current"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value)
              setHint(null)
              setError(null)
            }}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="s-pass-new">
            Новый пароль
          </label>
          <PasswordField
            id="s-pass-new"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value)
              setHint(null)
              setError(null)
            }}
            placeholder={AFFILIATE_PASSWORD_TOO_SHORT_TEXT}
          />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        <div>
          <label className="field-label" htmlFor="s-pass-repeat">
            Повторите пароль
          </label>
          <PasswordField
            id="s-pass-repeat"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(event) => {
              setRepeatPassword(event.target.value)
              setHint(null)
              setError(null)
            }}
            aria-invalid={hint !== null}
            placeholder="Ещё раз тот же пароль"
          />
          {hint !== null && (
            <p className="mt-1 text-xs text-[#FF3D71]" role="alert">
              {hint}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={passwordChange.isPending}
          className="btn min-h-[44px]"
        >
          {passwordChange.isPending ? 'Меняем…' : 'Сменить пароль'}
        </button>
      </div>
    </div>
  )
}
