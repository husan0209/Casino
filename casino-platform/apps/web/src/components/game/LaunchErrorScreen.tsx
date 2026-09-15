'use client'

import { LAUNCH_ACTION_LABELS, type LaunchErrorAction, type LaunchErrorView } from '@/lib/ui/launch-error'

/**
 * GAP-55 (в) (ТЗ ч.5 §8.4): ошибка запуска — отдельный экран, а не общий toast.
 * Обязательное свойство по §2.3.9 — следующий шаг: кнопки приходят из маппинга
 * ошибок, экран не бывает «тупиком».
 */
const PRIMARY: LaunchErrorAction[] = ['retry', 'deposit']

export function LaunchErrorScreen({
  view,
  code,
  onAction,
}: {
  view: LaunchErrorView
  code?: string | undefined
  onAction: (action: LaunchErrorAction) => void
}): React.JSX.Element {
  return (
    <div className="card space-y-4 border-[#FF3D71]/30">
      <div>
        <h2 className="text-lg font-semibold text-[#FF3D71]">{view.title}</h2>
        <p className="mt-1 text-sm text-muted">{view.text}</p>
      </div>
      <div className="space-y-2">
        {view.actions.map((action) => (
          <button
            key={action}
            type="button"
            className={`${PRIMARY.includes(action) ? 'btn' : 'btn-ghost'} w-full`}
            onClick={() => onAction(action)}
          >
            {LAUNCH_ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      {code !== undefined && (
        <p className="text-xs text-muted">
          Код ошибки: <span className="font-mono">{code}</span> — приложите его в обращение в поддержку.
        </p>
      )}
    </div>
  )
}
