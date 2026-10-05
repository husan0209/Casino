import Link from 'next/link'

import type { ReactNode } from 'react'

export type LegalSection = { heading: string; body: ReactNode }

/**
 * Публичная страница юридического документа (GAP-49, ТЗ ч.5 §4.6/§16.3, ч.7 §15.6).
 * Структура: заголовок, версия и дата, дисклеймер черновика, блок «Важная
 * информация», разделы с подзаголовками.
 * Тексты живут в `src/content/legal/*` — один источник на страницу.
 * `keyPoints` — не декор: обременительные условия должны быть выделены и
 * показаны до депозита (проминентность), иначе оговорка не считается
 * инкорпорированной (CRA 2015 s.68; отказ в выплате по неинкорпорированной
 * malfunction-оговорке — Betfred, High Court 2022).
 * Тон тела — `text-white/80` (≈9:1 на карте), а не `text-muted` (4.4:1 — для
 * длинного юридического текста мало). Оба выделенных блока — в одном нейтральном
 * тоне поверхности (решение владельца 2026-10-04 против янтаря); проминентность
 * keyPoints держится не цветом, а заголовком, списком и более светлым фоном.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
  notice,
  keyPoints,
}: {
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
  notice?: string
  keyPoints?: string[]
}): React.JSX.Element {
  return (
    <div className="container-1 py-8 max-w-2xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-1">{title}</h1>
        <p className="text-xs text-muted mb-4">Актуально на: {updated}</p>
        {notice ? (
          <p className="mb-4 rounded-xl border border-line bg-white/[0.03] p-3 text-[13px] leading-relaxed text-white/70">
            {notice}
          </p>
        ) : null}
        <p className="mb-6 text-sm leading-relaxed text-white/70">{intro}</p>
        {keyPoints && keyPoints.length > 0 ? (
          <section className="mb-6 rounded-xl border border-line bg-white/[0.05] p-4">
            <h2 className="mb-2 text-sm font-bold text-white">Важная информация</h2>
            <p className="mb-2 text-[13px] leading-relaxed text-white/80">
              Эти условия влияют на ваши права и выплаты. Прочитайте их до пополнения баланса — они
              раскрыты в разделах ниже в полном объёме.
            </p>
            <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-white/90 marker:text-muted">
              {keyPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="mb-2 border-b border-line pb-1.5 text-base font-semibold text-white">
                {s.heading}
              </h2>
              <div className="space-y-2 text-sm leading-relaxed text-white/80">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted mt-4 text-center">
        <Link href="/" className="text-white">
          ← На главную
        </Link>
      </p>
    </div>
  )
}
