'use client'

/**
 * GAP-55 (е) (ТЗ §22): игровой iframe вынесен в отдельный чанк — play-страница
 * грузит его через `dynamic(..., { ssr:false })`, чтобы шапка с балансом и
 * кнопкой кассы появлялись сразу, а тяжёлый фрейм провайдера подтягивался после
 * (§22: «dynamic import iframe», «не тащить игровые библиотеки в общий bundle»).
 * Размонтируется вместе с роутом: держать iframe в памяти после выхода из игры
 * запрещено §8.4.
 */
export function GameFrame({ url }: { url: string }): React.JSX.Element {
  return (
    <iframe
      src={url}
      title="Игровой экран"
      className="w-full flex-1 border-0"
      allow="fullscreen"
    />
  )
}
