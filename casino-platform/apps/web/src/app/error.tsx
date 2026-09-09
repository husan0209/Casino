'use client'

/**
 * ErrorBoundary маршрута (pre-launch hardening B6, 2026-09-04): конвенция
 * Next.js App Router. Без него любая ошибка рендера сегмента = белый экран
 * без навигации — игрок заперт на сломанной странице. Кнопка reset
 * перерисовывает сегмент (не reload), ошибка остаётся видимой в Sentry/логах.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">
        <h1 className="text-xl font-bold mb-2">Что-то сломалось</h1>
        <p className="text-muted text-sm mb-4">
          Мы уже знаем об ошибке. Попробуйте ещё раз — если не поможет, обновите страницу.
        </p>
        {error.digest !== undefined && (
          <p className="text-xs text-muted mb-4">Код: {error.digest}</p>
        )}
        <button className="btn w-full" onClick={reset}>
          Попробовать снова
        </button>
      </div>
    </div>
  )
}
