import { useId } from 'react'

/**
 * Лого сборки (ТЗ ч.5.1 §4.1): иконка-фишка в брендовом фиолетовом +
 * вордмарк «spinera»-стиля. Тот же мотив, что в public/favicon.svg.
 *
 * id градиента — свой на экземпляр. В шапке две копии логотипа (мобильная и
 * десктопная, одна из них прячется `display:none`), а ссылка вида
 * `url(#logo-grad)` берёт ПЕРВЫЙ по документу элемент с таким id. Если первый
 * лежит в скрытом поддереве, Chrome не использует его как краску — и у видимого
 * значка исчезает фиолетовый квадрат, остаётся только пунктир с точкой.
 */
export function Logo({
  size = 32,
  withWordmark = true,
}: {
  size?: number
  withWordmark?: boolean
}): React.JSX.Element {
  const gradientId = `logo-grad-${useId().replace(/:/g, '')}`

  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="64"
            y2="64"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#8B7FFF" />
            <stop offset="100%" stopColor="#6C63FF" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
        <circle
          cx="32"
          cy="32"
          r="17"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeDasharray="6 5"
          opacity="0.6"
        />
        <circle cx="32" cy="32" r="6" fill="#FFFFFF" />
        <circle cx="32" cy="32" r="2.5" fill="#6C63FF" />
      </svg>
      {withWordmark && <span className="text-lg font-extrabold tracking-tight">spinera</span>}
    </span>
  )
}
