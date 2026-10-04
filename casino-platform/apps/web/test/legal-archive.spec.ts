import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

import type { LegalSection } from '@/components/layout/LegalPage'
import { cookiesSections } from '@/content/legal/cookies'
import { privacySections } from '@/content/legal/privacy'
import { rgSections } from '@/content/legal/responsible-gaming'
import { termsSections } from '@/content/legal/terms'

import { LEGAL_DOCUMENT_VERSIONS, type LegalDocumentType } from '@casino/shared-types'

import type { ReactNode } from 'react'

/**
 * GAP-73: архив версий правовых документов.
 *
 * Terms §4/§23 обещают игроку копию ТОЙ редакции, которую он принял. Пока текст
 * живёт только в `apps/web/src/content/legal/*.tsx`, правка файла под новую
 * версию уничтожает старую — обещание становится неисполнимым. Архив в
 * `docs/legal/versions/` закрывает это, а спека не даёт ему разойтись:
 *  - каждая действующая версия реестра обязана иметь снимок;
 *  - снимок обязан совпадать по заголовкам и абзацам с тем, что рендерится;
 *  - sha256 в реестре обязан совпадать с байтом файла (иначе снимок молча поправили);
 *  - в архиве не должно быть сиротских снимков и висячих записей.
 *
 * Хеш считается после нормализования конца строки: git на Windows при checkout
 * выдаёт CRLF, а в реестре зафиксирован хеш LF-байтов (.editorconfig и prettier
 * endOfLine=lf). Без нормализации спека краснела бы только на Windows.
 */
const ARCHIVE_ROOT = resolve(__dirname, '../../../docs/legal/versions')

interface RegistryEntry {
  file: string
  sha256: string
  publishedAt: string
}
type Registry = Record<string, Partial<Record<LegalDocumentType, RegistryEntry>>>

const registry = JSON.parse(
  readFileSync(resolve(ARCHIVE_ROOT, 'registry.json'), 'utf8'),
) as Registry

const DOCUMENTS: Record<LegalDocumentType, LegalSection[]> = {
  terms: termsSections,
  privacy: privacySections,
  cookies: cookiesSections,
  responsible_gaming: rgSections,
}

function entryOf(version: string, document: LegalDocumentType): RegistryEntry {
  const entry = registry[version]?.[document]
  if (entry === undefined) {
    throw new Error(`в registry.json нет записи ${version}/${document}`)
  }
  return entry
}

/** Собирает текстовые узлы из React-дерева абзацев (body у секций — JSX). */
function collectText(node: ReactNode, out: string[]): void {
  if (typeof node === 'string') {
    if (node.trim() !== '') {
      out.push(node.trim())
    }
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectText(child, out)
    }
    return
  }
  if (node !== null && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    collectText(props?.children ?? null, out)
  }
}

const normalize = (value: string): string => value.replace(/\r\n/g, '\n')
const collapse = (value: string): string => normalize(value).replace(/\s+/g, ' ').trim()

describe('GAP-73: архив правовых документов', () => {
  for (const [document, sections] of Object.entries(DOCUMENTS)) {
    const id = document as LegalDocumentType
    const version = LEGAL_DOCUMENT_VERSIONS[id]

    it(`${id} ${version}: снимок существует и совпадает с реестром по байтам`, () => {
      const entry = entryOf(version, id)
      const raw = readFileSync(resolve(ARCHIVE_ROOT, entry.file))
      const digest = createHash('sha256')
        .update(normalize(raw.toString('utf8')), 'utf8')
        .digest('hex')

      expect(digest).toBe(entry.sha256)
      expect(entry.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it(`${id}: заголовки и абзацы архива совпадают с тем, что рендерит страница`, () => {
      const entry = entryOf(version, id)
      const snapshot = collapse(readFileSync(resolve(ARCHIVE_ROOT, entry.file), 'utf8'))

      for (const section of sections) {
        expect(snapshot, `в снимке нет заголовка «${section.heading}»`).toContain(
          collapse(section.heading),
        )
        const paragraphs: string[] = []
        collectText(section.body, paragraphs)
        expect(paragraphs.length, `в секции «${section.heading}» нет абзацев`).toBeGreaterThan(0)
        for (const paragraph of paragraphs) {
          expect(
            snapshot,
            `в снимке нет абзаца «${paragraph.slice(0, 60)}…» — текст правили без архива`,
          ).toContain(collapse(paragraph))
        }
      }
    })
  }

  it('реестр и файлы архива совпадают: ни висячих записей, ни сиротских снимков', () => {
    const referenced = new Set<string>()
    for (const entries of Object.values(registry)) {
      for (const entry of Object.values(entries)) {
        referenced.add(entry.file)
        expect(existsSync(resolve(ARCHIVE_ROOT, entry.file)), `нет файла ${entry.file}`).toBe(true)
      }
    }

    const onDisk = new Set<string>()
    for (const versionDir of readdirSync(ARCHIVE_ROOT, { withFileTypes: true })) {
      if (!versionDir.isDirectory()) {
        continue
      }
      for (const file of readdirSync(resolve(ARCHIVE_ROOT, versionDir.name))) {
        onDisk.add(`${versionDir.name}/${file}`)
      }
    }

    const orphans = [...onDisk].filter((file) => !referenced.has(file))
    expect(orphans, `в архиве снимки без записи в реестре: ${orphans.join(', ')}`).toEqual([])
  })
})
