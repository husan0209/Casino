import type { ReactNode } from 'react'

/**
 * Абзацный помощник для юридических текстов: каждый аргумент — отдельный <p>.
 * Правовые документы живут данными (массив строк), а не JSX-разметкой, чтобы
 * юрист правил текст, не трогая вёрстку (GAP-49).
 */
export function block(...lines: string[]): ReactNode {
  return (
    <>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  )
}
