#!/usr/bin/env python3
"""
Локальная проверка import/order для линтуемых деревьев (GAP-39/52/55).

Зачем: на Termux eslint не запускается (ajv@6 обрезан FUSE-деревом), а CI ловил
regression по этой же правиле трижды — #83, #85, #86. Инструмент проверяет
дифф ветки ДО пуша.

Модель правил (корневой .eslintrc.js):
  groups: [builtin, external, internal, [parent, sibling, index], type]
  pathGroups: @/**, @modules/**, @casino/** → internal, position: after
  newlines-between: always            → пустая строка МЕЖДУ рангами обязательна
                                        и запрещена ВНУТРИ одного ранга
  alphabetize: { asc, caseInsensitive }
Эмпирически (main зелёный): external → @/ → @modules → @casino → relative,
type-only импорт НЕ из @/-пути — в последнюю группу 'type' (regression #86:
`import type { Metadata } from 'next'` в начале файла).

ЭВРИСТИКА, авторитет — CI. Известные ложные классы: parent-vs-sibling внутри
одной группы ['parent','sibling','index'] (алфавит там сравнивается по
подгруппам). Скоуп — только apps/{api,web,admin}/src: test/**, *.config.ts и
packages/* линтер не проверяет.

Запуск:  python3 scripts/check-import-order.py [--selftest]
Выход:   0 — чисто, 1 — есть нарушения (или провален selftest).
"""
import os
import re
import subprocess
import tempfile
import sys

BUILTIN = {
    'assert', 'buffer', 'child_process', 'crypto', 'dns', 'events', 'fs', 'http',
    'https', 'module', 'net', 'os', 'path', 'process', 'querystring', 'readline',
    'stream', 'string_decoder', 'timers', 'tls', 'url', 'util', 'v8', 'vm',
    'worker_threads', 'zlib',
}

RANK_OF = {
    'builtin': 0, 'ext': 1, 'at': 2, 'modules': 3, 'casino': 4,
    'rel': 5, 'type': 6,
}

FROM_RE = re.compile(r"from\s+'([^']+)'")
LINTED_PREFIXES = ('apps/api/src/', 'apps/web/src/', 'apps/admin/src/')


def rank(path, type_only=False):
    """Группа импорта по пути (см. докстринг модуля)."""
    if type_only and not path.startswith(('@/', '@modules/', '@casino/')):
        return ('type', path)
    base = path[5:] if path.startswith('node:') else path
    if path.startswith('node:') or base in BUILTIN:
        return ('builtin', path)
    if path.startswith('@/'):
        return ('at', path)
    if path.startswith('@modules/'):
        return ('modules', path)
    if path.startswith('@casino/'):
        return ('casino', path)
    if path.startswith('.'):
        return ('rel', path)
    return ('ext', path)


def specifier(line):
    """Путь из `... from 'x'`; None — side-effect импорт (он не ранжируется)."""
    match = FROM_RE.search(line)
    return match.group(1) if match else None


def collect(absolute):
    """Список (строка, группа, путь, была_перед_этим_пустая_строка)."""
    found = []
    blank_seen = False
    pending = None  # (номер, blank, type_only) для многострочного import
    with open(absolute, encoding='utf-8') as handle:
        lines = handle.read().split('\n')
    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if line == '':
            if found or pending is not None:
                blank_seen = True
            continue
        if line.startswith(('//', '/*', '*')):
            continue  # док-блок ТЗ между импортами нейтрален
        path = specifier(line)
        if pending is not None:
            # многострочный import: тело ({ a, b }) и закрывающая `} from '...'`
            # строки не начинаются с import — ждём строку с from
            if path is None:
                continue
            number, blank_seen, type_only = pending
            pending = None
        else:
            if not line.startswith('import'):
                blank_seen = False
                continue
            type_only = line.startswith('import type')
            if path is None:
                pending = (number, blank_seen, type_only)
                blank_seen = False
                continue
        group, normalized = rank(path, type_only)
        found.append((number, group, normalized, blank_seen))
        blank_seen = False
    return found


def problems_in(absolute):
    problems = []
    entries = collect(absolute)
    for index in range(1, len(entries)):
        number, group, path, blank = entries[index]
        _, previous_group, previous_path, _ = entries[index - 1]
        same_rank = RANK_OF[group] == RANK_OF[previous_group]
        if RANK_OF[group] < RANK_OF[previous_group]:
            problems.append(f'{absolute}:{number} группа раньше предыдущей: {path}')
        elif same_rank:
            if blank:
                problems.append(f'{absolute}:{number} пустая строка внутри ранга: {path}')
            if path.lower() < previous_path.lower():
                problems.append(f'{absolute}:{number} не по алфавиту: {path} < {previous_path}')
        elif not blank:
            problems.append(f'{absolute}:{number} нет пустой строки между группами: {path}')
    return problems


def changed_files(root):
    listed = set()
    for args in (
        ('git', 'diff', '--name-only', 'main...HEAD'),
        ('git', 'diff', '--name-only'),
        ('git', 'ls-files', '--others', '--exclude-standard'),
    ):
        res = subprocess.run(args, cwd=root, capture_output=True, text=True)
        for line in res.stdout.split('\n'):
            name = line.strip().strip('"').split(' -> ')[-1]
            rel = name.split('casino-platform/', 1)[-1]
            if not rel or 'node_modules' in rel:
                continue
            if not rel.startswith(LINTED_PREFIXES) or not rel.endswith(('.ts', '.tsx')):
                continue
            listed.add(os.path.normpath(os.path.join(root, 'casino-platform', rel)))
    return sorted(listed)


def selftest():
    """Инструмент обязан ловить регрессии; проверяем это на синтетике."""
    cases = [
        # (описание, текст файла, ожидается ли нарушение)
        ('type-only из next в начале файла (regression #86)',
         "import type { Metadata } from 'next'\nimport { X } from '@/a'\nexport default X\n", True),
        ('правильный порядок с type в конце',
         "import { X } from '@/a'\n\nimport type { Metadata } from 'next'\nexport default X\n", False),
        ('многострочный import вне алфавита (#85)',
         "import {\n  b,\n} from '@/lib/ui/history-filters'\nimport { a } from '@/lib/ui/game'\n", True),
        ('пустая строка внутри одного ранга',
         "import { a } from '@/lib/a'\n\nimport { b } from '@/lib/b'\n", True),
        ('side-effect импорт не ломает порядок',
         "import './globals.css'\nimport { a } from '@/x'\n", False),
    ]
    failed = 0
    for description, source, expect_problem in cases:
        handle_out = tempfile.NamedTemporaryFile(
            suffix='.ts', mode='w', delete=False, encoding='utf-8')
        path = handle_out.name
        with handle_out:
            handle_out.write(source)
        found = bool(problems_in(path))
        os.unlink(path)
        status = 'ok' if found == expect_problem else 'ПРОВАЛ'
        if found != expect_problem:
            failed += 1
        print(f'  [{status}] {description}')
    print(f'selftest: {len(cases) - failed}/{len(cases)} ок')
    return 1 if failed else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()
    root = subprocess.run(('git', 'rev-parse', '--show-toplevel'),
                          capture_output=True, text=True).stdout.strip()
    problems = []
    checked = 0
    for absolute in changed_files(root):
        if not os.path.isfile(absolute):
            print(f'пропущен (не найден): {absolute}')
            continue
        checked += 1
        problems.extend(problems_in(absolute))
    print(f'проверено файлов: {checked}, нарушений: {len(problems)}')
    for problem in problems:
        print('  ' + problem)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
