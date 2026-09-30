/**
 * Лого сборки (ТЗ ч.5.1 §4.1): иконка-фишка в брендовом фиолетовом + вордмарк.
 * «spinera» — имя мока-донора, под своим брендом оно не продаётся.
 * Тот же мотив, что в public/favicon.svg.
 */
export function Logo({
  size = 32,
  withWordmark = true,
}: {
  size?: number
  withWordmark?: boolean
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
        <defs>
          <linearGradient
            id="logo-grad"
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
        <rect width="64" height="64" rx="16" fill="url(#logo-grad)" />
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
      {withWordmark && <span className="text-lg font-extrabold tracking-tight">Casino</span>}
    </span>
  )
}
