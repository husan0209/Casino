'use client'

/**
 * GlobalError (pre-launch hardening B6, 2026-09-04): ловит ошибки корневого
 * layout'а админки. Рендерится БЕЗ корневого layout — минимальный HTML.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return (
    <html lang="ru">
      <body style={{ fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 420, margin: '96px auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20 }}>Ошибка приложения</h1>
          <p style={{ color: '#888', fontSize: 14 }}>Попробуйте обновить страницу.</p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '10px 20px',
              background: '#6C63FF',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Обновить
          </button>
        </div>
      </body>
    </html>
  )
}
