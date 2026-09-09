'use client'

/**
 * ErrorBoundary маршрута (pre-launch hardening B6, 2026-09-04): конвенция
 * Next.js App Router. Без него ошибка рендера сегмента админки = белый экран
 * без навигации (а админ во время инцидента — последний, кто должен терять
 * доступ к панели).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return (
    <div style={{ maxWidth: 420, margin: '96px auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Ошибка интерфейса</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
        Сегмент не отрисовался. Попробуйте снова — данные не затронуты.
      </p>
      {error.digest !== undefined && (
        <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>Код: {error.digest}</p>
      )}
      <button
        onClick={reset}
        style={{
          padding: '10px 20px',
          background: '#6C63FF',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Попробовать снова
      </button>
    </div>
  )
}
