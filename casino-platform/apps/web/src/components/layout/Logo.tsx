/**
 * Лого сборки: фишка (чип) в брендовом фиолетовом + опциональный вордмарк.
 * Тот же мотив, что в public/favicon.svg. ТЗ ч.5.1 §4.1: лого слева в шапке;
 * §2 пр.10: лого + тэглайн в футере.
 */
export function Logo({ size = 32, withWordmark = true }: {
  size?: number
  withWordmark?: boolean
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden
        className="shrink-0"
      >
        <rect width="64" height="64" rx="16" fill="#6C63FF" />
        <circle cx="32" cy="32" r="17" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeDasharray="6 5" />
        <circle cx="32" cy="32" r="5.5" fill="#FFFFFF" />
      </svg>
      {withWordmark && (
        <span className="text-lg font-extrabold tracking-tight">Casino</span>
      )}
    </span>
  )
}
