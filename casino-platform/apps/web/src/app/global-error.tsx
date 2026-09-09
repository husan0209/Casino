'use client'

/**
 * GlobalError (pre-launch hardening B6, 2026-09-04): ловит ошибки корневого
 * layout'а (падения providers/шells). Рендерится БЕЗ корневого layout —
 * минимальный HTML. Не замена error.tsx (сегментные), а последний рубеж.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return (
    <html lang="ru">
      <body style={{ background: '#0F0F1A', color: '#8888AA', fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 420, margin: '96px auto', textAlign: 'center' }}>
          <h1 style={{ color: '#FFFFFF', fontSize: 20 }}>Ошибка приложения</h1>
          <p style={{ fontSize: 14 }}>Попробуйте обновить страницу.</p>
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
