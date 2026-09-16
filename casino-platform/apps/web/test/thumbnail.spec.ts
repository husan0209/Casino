/**
 * GAP-55 (е) (ТЗ §22): выбор источника обложки. next/image принимает только
 * хосты из allowlist; всё остальное — обычный lazy-<img>. Тест фиксирует и
 * поддомены, и то, что /uploads/ (nginx-статик) НЕ уходит в оптимизатор Next.
 */
import { describe, expect, it } from 'vitest'

import {
  isAllowedImageHost,
  parseImageHosts,
  thumbSource,
} from '../src/lib/ui/thumbnail'

const HOSTS = parseImageHosts('cdn.gitslotpark.com, IMG.Example.com ,')

describe('GAP-55 allowlist хостов картинок', () => {
  it('чистит список из env: пробелы, регистр, пустые элементы', () => {
    expect(HOSTS).toEqual(['cdn.gitslotpark.com', 'img.example.com'])
    expect(parseImageHosts(undefined)).toEqual([])
  })

  it('точное совпадение и поддомен', () => {
    expect(isAllowedImageHost('https://cdn.gitslotpark.com/a/webp/sweet.webp', HOSTS)).toBe(true)
    expect(isAllowedImageHost('https://img.cdn.gitslotpark.com/a.png', HOSTS)).toBe(true)
  })

  it('чужие хосты и похожие префиксы не пропускаются', () => {
    expect(isAllowedImageHost('https://evil.example.net/x.png', HOSTS)).toBe(false)
    // префикс-подмена: cdn.gitslotpark.com.evil.net не должен проходить
    expect(isAllowedImageHost('https://cdn.gitslotpark.com.evil.net/x.png', HOSTS)).toBe(false)
  })

  it('не-URL и битые ссылки не роняют проверку', () => {
    expect(isAllowedImageHost('not a url', HOSTS)).toBe(false)
    expect(isAllowedImageHost('//cdn.gitslotpark.com/x.png', HOSTS)).toBe(false)
  })
})

describe('GAP-55 thumbSource: куда идёт обложка', () => {
  it('без ссылки — заглушка (карточка не остаётся пустой)', () => {
    expect(thumbSource(null, HOSTS)).toEqual({ kind: 'none' })
    expect(thumbSource('   ', HOSTS)).toEqual({ kind: 'none' })
  })

  it('разрешённый CDN — next/image (webp/avif, blur, lazy)', () => {
    expect(thumbSource('https://cdn.gitslotpark.com/a.webp', HOSTS)).toEqual({
      kind: 'next',
      src: 'https://cdn.gitslotpark.com/a.webp',
    })
  })

  it('чужой https — обычный <img>, не прокси через наш оптимизатор', () => {
    expect(thumbSource('https://other-host.io/a.png', HOSTS)).toEqual({
      kind: 'raw',
      src: 'https://other-host.io/a.png',
    })
  })

  it('свой /uploads/ (отдаёт nginx) — тоже <img>: через /_next/image такой путь 404-ится', () => {
    expect(thumbSource('/uploads/games/a.png', HOSTS)).toEqual({
      kind: 'raw',
      src: '/uploads/games/a.png',
    })
  })
})
