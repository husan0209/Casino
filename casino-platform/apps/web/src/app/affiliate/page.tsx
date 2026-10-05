'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { affiliateGet } from '@/lib/affiliate-api'
import { type AffiliateProgramDto } from '@/types/affiliate'

/** Шаги «как это работает» — партнёру нужен ответ до регистрации. */
const STEPS: Array<{ title: string; text: string }> = [
  {
    title: 'Регистрируйтесь',
    text: 'Укажите email и примите условия. Сразу получите персональную ссылку — промо-код выдаётся автоматически.',
  },
  {
    title: 'Приводите игроков',
    text: 'Делитесь ссылкой или deep-link на конкретную игру. Cookie-атрибуция работает 30 дней с момента клика.',
  },
  {
    title: 'Получайте RevShare',
    text: 'Ежедневно начисляем процент от чистого игрового дохода (NGR) ваших игроков. Начисления приходят на баланс кошелька.',
  },
  {
    title: 'Выводите',
    text: 'Заработок выводится через обычную кассу казино — по тем же правилам, что и у игрока, включая KYC.',
  },
]

/** Формула NGR раскрыта честно: партнёры проверяют расчёт, скрытая формула
 *  разрушает доверие быстрее, чем низкая ставка (ТЗ ч.8 §3.9). */
const FORMULA: Array<{ term: string; note: string }> = [
  { term: 'Ставки', note: 'сумма всех ставок игроков' },
  { term: '− Выигрыши', note: 'сумма всех выигрышей' },
  { term: '− Отмены', note: 'откаты и возвраты ставок' },
  { term: '− Бонусы', note: 'бонусы, начисленные игрокам' },
  { term: '= NGR', note: 'чистый игровой доход — база для RevShare' },
]

export default function AffiliateProgramPage(): React.JSX.Element {
  const { data: program } = useQuery({
    queryKey: ['aff-program'],
    queryFn: () => affiliateGet<AffiliateProgramDto>('/affiliate/program'),
  })

  const ratePercent = program ? (Number(program.revshare_rate) * 100).toFixed(0) : null

  return (
    <div className="container-1 py-6 max-w-4xl">
      <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
      <h1 className="page-title mb-2">Зарабатывайте вместе с казино</h1>
      <p className="text-muted mb-6 max-w-2xl">
        Приводите игроков по персональной ссылке и получайте процент от их чистого игрового дохода.
        Начисления — ежедневно, прозрачно, с полной разбивкой расчёта.
      </p>

      {program?.enabled === false && (
        <div className="card mb-6 border-[#FF3D71]/40">
          <div className="text-[#FF3D71] text-sm font-semibold">
            Регистрация партнёров временно закрыта
          </div>
          <div className="text-muted text-sm mt-1">
            Программа возобновится позже. Следите за обновлениями.
          </div>
        </div>
      )}

      {/* Ключевые числа — то, что партнёр хочет узнать первым */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <div className="card">
          <div className="text-muted text-sm">Ваш RevShare</div>
          <div className="text-3xl font-black text-money-dark mt-1">
            {ratePercent !== null ? `${ratePercent}%` : '…'}
          </div>
          <div className="text-muted text-xs mt-1">от NGR ваших игроков</div>
        </div>
        <div className="card">
          <div className="text-muted text-sm">Cookie-окно</div>
          <div className="text-3xl font-black mt-1">{program?.cookie_days ?? '…'}</div>
          <div className="text-muted text-xs mt-1">дней атрибуции с клика</div>
        </div>
        <div className="card">
          <div className="text-muted text-sm">Начисления</div>
          <div className="text-3xl font-black mt-1">Ежедневно</div>
          <div className="text-muted text-xs mt-1">за предыдущие сутки</div>
        </div>
      </div>

      {/* Как считается — главный раздел для доверия */}
      <section className="mb-8">
        <p className="caps-label">ПРОЗРАЧНЫЙ РАСЧЁТ</p>
        <h2 className="section-title mb-3">Как считается комиссия</h2>
        <div className="card">
          <div className="space-y-2">
            {FORMULA.map((row, index) => (
              <div
                key={row.term}
                className="flex items-baseline justify-between gap-4 py-1.5 border-b border-white/5 last:border-0"
              >
                <span
                  className={
                    row.term === '= NGR' ? 'font-bold text-money-dark' : 'font-medium text-white'
                  }
                >
                  {index === 0 ? row.term : row.term}
                </span>
                <span className="text-muted text-sm text-right">{row.note}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 text-sm text-muted">
            Комиссия = NGR × ваша ставка. Отрицательный NGR (игрок выиграл больше, чем поставил)
            комиссии не даёт — вы не платите за убыточных игроков.
          </div>
        </div>
      </section>

      <section className="mb-8">
        <p className="caps-label">КАК НАЧАТЬ</p>
        <h2 className="section-title mb-3">Четыре шага</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="card">
              <div className="flex items-start gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold">
                  {index + 1}
                </div>
                <div>
                  <div className="font-semibold">{step.title}</div>
                  <div className="text-muted text-sm mt-1">{step.text}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Ответственная игра — обязателен для гемблинг-вертикали (ТЗ ч.8 §14.1) */}
      <div className="card mb-6 border-[#FFB300]/30">
        <div className="font-semibold text-[#FFB300] mb-2">Условия и ответственная игра</div>
        <ul className="text-muted text-sm space-y-1.5 list-disc pl-5">
          <li>Материалы только для лиц 18+. Запрещены обещания гарантированного выигрыша.</li>
          <li>Нельзя привлекать самоисключённых игроков — такие начисления отменяются.</li>
          <li>
            Запрещена контекстная реклама по бренду казино и вымышленные «выигрыши» в креативах.
          </li>
          <li>Партнёрская программа доступна только для совершеннолетних в своей юрисдикции.</li>
        </ul>
        <div className="text-muted text-xs mt-3">
          Версия условий: {program?.terms_version ?? '1.0'}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/affiliate/register" className="btn">
          Стать партнёром
        </Link>
        <Link href="/affiliate/login" className="btn-ghost">
          Войти в кабинет
        </Link>
      </div>
    </div>
  )
}
