/**
 * GAP-55: контракт игры (витрина/каталог/страница игры).
 *
 * Специально фиксирует РЕАЛЬНЫЕ имена полей ответа API (nameRu / isNew / isPopular
 * / hasDemo): в web-DTO они были подписаны snake_case, из-за чего бейджи и кнопка
 * «Демо» не рендерились, а русские названия не показывались. Без этого теста
 * расхождение могло бы вернуться так же молча.
 */
import { describe, expect, it } from 'vitest'

import { gameBadge, gameDisplayName, gameHasDemo, gameRtpLabel } from '../src/lib/ui/game'

describe('GAP-55 имя игры (§6.4)', () => {
  it('русское название приоритетно', () => {
    expect(gameDisplayName({ name: 'Sweet Bonanza', nameRu: 'Сладкая бонанза' })).toBe('Сладкая бонанза')
  })

  it('пустое/пробельное nameRu → оригинал (не пустая карточка)', () => {
    expect(gameDisplayName({ name: 'Book of Dead', nameRu: null })).toBe('Book of Dead')
    expect(gameDisplayName({ name: 'Book of Dead', nameRu: '   ' })).toBe('Book of Dead')
    expect(gameDisplayName({ name: 'Book of Dead' })).toBe('Book of Dead')
  })
})

describe('GAP-55 бейдж: один на карточку, NEW или HOT (§6.4)', () => {
  it('NEW важнее HOT, когда оба флага true', () => {
    expect(gameBadge({ isNew: true, isPopular: true })).toBe('NEW')
  })

  it('по одному флагу — соответствующий бейдж', () => {
    expect(gameBadge({ isNew: true })).toBe('NEW')
    expect(gameBadge({ isPopular: true })).toBe('HOT')
  })

  it('без флагов — никакого бейджа', () => {
    expect(gameBadge({})).toBeNull()
    expect(gameBadge({ isNew: false, isPopular: false })).toBeNull()
  })
})

describe('GAP-55 RTP: Decimal из API приходит строкой', () => {
  it('строка и число форматируются одинаково, хвостовые нули убираются', () => {
    expect(gameRtpLabel('96.50')).toBe('96.5%')
    expect(gameRtpLabel(96)).toBe('96%')
    expect(gameRtpLabel('96.555')).toBe('96.56%')
  })

  it('null/пусто/0/мусор — не показываем (в превью нет «RTP NaN%»)', () => {
    expect(gameRtpLabel(null)).toBeNull()
    expect(gameRtpLabel(undefined)).toBeNull()
    expect(gameRtpLabel('')).toBeNull()
    expect(gameRtpLabel('0')).toBeNull()
    expect(gameRtpLabel('abc')).toBeNull()
  })
})

describe('GAP-55 демо (§8.4)', () => {
  it('кнопка только при hasDemo === true (именно hasDemo, не has_demo)', () => {
    expect(gameHasDemo(true)).toBe(true)
    expect(gameHasDemo(false)).toBe(false)
    expect(gameHasDemo(undefined)).toBe(false)
  })
})
