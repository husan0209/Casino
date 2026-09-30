/**
 * Аватар пользователя (ТЗ ч.5.1 §2 пр.8, §4.1): реальная аватарка, при её
 * отсутствии — первая буква email на градиентном фоне (как в донорах:
 * «М» у VANTA — фиолетово-розовый градиент, «AK» у spinera — розово-оранжевый).
 * Используется в шапке и в таб-баре («Профиль» у залогиненного).
 */

/** Стабильный градиент по первой букве: одинаковый email → одинаковый цвет. */
const GRADIENTS = [
  'from-[#6C63FF] to-[#A855F7]', // фиолетовый
  'from-[#E53E3E] to-[#F56565]', // красный
  'from-[#3182CE] to-[#63B3ED]', // синий
  'from-[#D69E2E] to-[#F6E05E]', // золотой
  'from-[#38B2AC] to-[#4FD1C5]', // бирюзовый
  'from-[#805AD5] to-[#B794F4]', // лавандовый
  'from-[#DD6B20] to-[#F6AD55]', // оранжевый
  'from-[#E53E3E] to-[#9B2C2C]', // тёмно-красный
] as const

function pickGradient(email: string | null): string {
  const code = email ? email.charCodeAt(0) : 0
  return GRADIENTS[code % GRADIENTS.length]!
}

export function UserAvatar({
  email,
  avatarUrl,
  size = 32,
}: {
  email: string | null
  avatarUrl?: string | null
  size?: number
}): React.JSX.Element {
  const dimension = { width: size, height: size }

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        style={dimension}
        className="shrink-0 rounded-full border-2 border-[#2A2A4A] object-cover"
      />
    )
  }

  const initial = (email?.[0] ?? '?').toUpperCase()
  const gradient = pickGradient(email)

  return (
    <span
      style={dimension}
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradient} text-xs font-bold text-white shadow-md`}
    >
      {initial}
    </span>
  )
}
