/**
 * Аватар пользователя (ТЗ ч.5.1 §2 пр.8, §4.1): реальная аватарка, при её
 * отсутствии — первая буква email на брендовом градиенте (как в донорах:
 * «М» у VANTA, «AK» у spinera). Сессионный WebUser аватарки не несёт —
 * avatarUrl подключится из данных профиля в волне W5.
 * Используется в шапке и в таб-баре («Профиль» у залогиненного).
 */
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
        className="shrink-0 rounded-full border border-[#2A2A4A] object-cover"
      />
    )
  }

  const initial = (email?.[0] ?? '?').toUpperCase()
  return (
    <span
      style={dimension}
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#6C63FF] to-[#9A63FF] text-xs font-bold text-white"
    >
      {initial}
    </span>
  )
}
