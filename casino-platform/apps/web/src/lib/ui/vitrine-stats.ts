/**
 * Витринные цифры соцдоказательства: BIG WIN-плашка, «сейчас в игре»,
 * «игроков уже сегодня».
 *
 * Поля «выигрыш по игре» и «онлайн по игре» в API отсутствуют (живой контур
 * провайдера ещё не принят — GAP-46), поэтому на старте цифры витринные.
 * Чтобы витрина не выдавала себя за хардкод, значения НЕ статичны: они
 * детерминированы парой (слаг, временной бакет ~4 минуты) — сервер и клиент
 * при гидрации считаются одинаково, а от визита к визиту и ото дня к дню
 * цифры меняются: «+30 700 ₽» не висит неделями, суточный онлайн дышит.
 *
 * Калибровка по индустрии: тировая система слотов — Big ≈ 15–20× ставки
 * (частота ~1/48–66 спинов), Mega ≈ 30–40×, Epic ≈ 60–100× (Relax Gaming
 * Titan Strike, Evoplay). При ставках 50–300 ₽ это даёт рублёвые коридоры:
 * 0.8–7 тыс. (частые), 7–35 тыс. (заметные), 35–150 тыс. (редкие хвосты).
 * Публичного стандарта на «игроков онлайн» нет — коридоры подобраны под
 * растущее казино: единицы–сотни на игру, вечерний пик по суткам.
 *
 * Деньги: только целочисленная арифметика, `toLocaleString` — отображение
 * (§Деньги). `Math.cos` применяется только к счётчикам игроков, не к суммам.
 */

/** Период ротации витринных цифр: бакет в 4 минуты. */
export const VITRINE_ROTATE_MS = 4 * 60 * 1000

const ROUND_TO = 100

function timeBucket(now: number): number {
  return Math.floor(now / VITRINE_ROTATE_MS)
}

/**
 * 32-битный хэш с полноценным лавашем: FNV-1a + финализатор murmur3 (fmix32).
 * djb2 здесь не годится: у строк, отличающихся только младшими цифрами бакета,
 * хэши отличаются на единицы — после нормировки «случайность» между соседними
 * бакетами почти не меняется, и витрина вырождается в константу.
 */
function hash32(value: string, salt: number): number {
  let hash = (salt ^ 0x9e3779b9) >>> 0
  for (let symbolIndex = 0; symbolIndex < value.length; symbolIndex += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(symbolIndex), 0x01000193) >>> 0
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b) >>> 0
  hash ^= hash >>> 16
  return hash >>> 0
}

/** Детерминированная «случайность» ∈ [0, 1) на тройке (ключ, соль, бакет). */
function uniform(key: string, salt: number, bucket: number): number {
  return hash32(`${key}#${bucket}`, salt) / 0x100000000
}

function roundTo100(amount: number): number {
  return Math.max(ROUND_TO, Math.round(amount / ROUND_TO) * ROUND_TO)
}

/**
 * BIG WIN-плашка «только что»: тировое распределение — 62% частых (Big),
 * 30% заметных (Mega), 8% редких хвостов. Смена состава — каждый бакет.
 */
export function bigWinLabel(slug: string, now: number = Date.now()): string {
  const bucket = timeBucket(now)
  const tier = uniform(slug, 17, bucket)
  let amount: number
  if (tier < 0.62) {
    amount = 800 + Math.floor(uniform(slug, 23, bucket) * 6200)
  } else if (tier < 0.92) {
    amount = 7000 + Math.floor(uniform(slug, 29, bucket) * 28000)
  } else {
    amount = 35000 + Math.floor(uniform(slug, 31, bucket) * 115000)
  }
  return `+${roundTo100(amount).toLocaleString('ru-RU')} ₽`
}

/**
 * Суточная кривая онлайна (доля от пика): минимум ~05:00, к вечеру ~0.8,
 * плавный горб на день. Часы берутся локальные — у аудитории один регион.
 */
function diurnalFactor(now: number): number {
  const moment = new Date(now)
  const hour = moment.getHours() + moment.getMinutes() / 60
  const phase = ((hour - 5) / 24) * 2 * Math.PI
  return 0.18 + 0.82 * (0.5 - 0.5 * Math.cos(phase))
}

/** «N игроков сейчас в игре» на конкретной карте: база × суточная кривая × шум. */
export function playersOnline(slug: string, now: number = Date.now()): number {
  const bucket = timeBucket(now)
  // «Хиты» каталога: примерно каждая пятая игра заметно популярнее.
  const isHeadliner = hash32(slug, 101) % 5 === 0
  const base = isHeadliner
    ? 120 + Math.floor(uniform(slug, 103, bucket) * 260)
    : 6 + Math.floor(uniform(slug, 107, bucket) * 84)
  const noise = 0.85 + uniform(slug, 109, bucket) * 0.3
  return Math.max(1, Math.round(base * diurnalFactor(now) * noise))
}

/** Счётчик «игроков уже сегодня»: дневная база 9–15 тыс., растёт к вечеру. */
export function playersTodayCount(now: number = Date.now()): number {
  const moment = new Date(now)
  const dayKey = `${moment.getFullYear()}-${moment.getMonth()}-${moment.getDate()}`
  const dailyBase = 9000 + Math.floor(uniform(dayKey, 131, 0) * 6000)
  const minutes = moment.getHours() * 60 + moment.getMinutes()
  const progress = 0.12 + 0.88 * (minutes / 1440)
  return roundTo100(dailyBase * progress)
}
