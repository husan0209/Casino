/**
 * Ошибка запроса ≠ пустой список: без отдельного блока страница выдаёт
 * «записей нет» там, где просто упал API (ТЗ ч.5 §13 — состояния как экраны).
 */
export function ErrorBanner({
  text,
  onRetry,
}: {
  text: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#FF3D71]/30 bg-[#FF3D71]/5 px-4 py-3 text-sm">
      {text}
      <button type="button" className="btn-ghost shrink-0 px-3 py-1 text-xs" onClick={onRetry}>
        Повторить
      </button>
    </div>
  )
}
