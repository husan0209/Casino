#!/usr/bin/env python3
"""
Локальная проверка import/order для фронта (GAP-39/52/55: CI ловил нарушения
трижды, а на Termux eslint не запускается — ajv@6 обрезан FUSE-деревом).

Покрывает ВСЕ файлы ветки (main...HEAD + незакоммиченные + untracked).
Первая версия чекера молчала именно потому, что смотрела только незакоммиченные
файлы — это и есть причина, по которой #83 покраснел на пустом месте.

Правила повторяют корневой .eslintrc.js:
  groups: external → internal(@/) → @modules → @casino → relative
  newlines-between: always  ⇒ пустая строка МЕЖДУ группами обязательна
                             и запрещена внутри одной группы
  alphabetize: { order: asc, caseInsensitive: true }
Выход 0 — чисто, 1 — есть нарушения.
"""
import os
import re
import subprocess
import sys

RANK_OF = {'ext': 0, 'at': 1, 'modules': 2, 'casino': 3, 'rel': 4}
FROM_RE = re.compile(r"from\s+'([^']+)'")
BARE_RE = re.compile(r"^import\s+'([^']+)'")


def _specifier(line):
    """Путь из строки import: `from '...'` (в т.ч. конец многострочного) или side-effect `import '...'`."""
    match = FROM_RE.search(line)
    if match:
        return match.group(1)
    match = BARE_RE.match(line)
    return match.group(1) if match else None


def rank(path):
    if path.startswith('@/'):
        return ('at', path)
    if path.startswith('@modules/'):
        return ('modules', path)
    if path.startswith('@casino/'):
        return ('casino', path)
    if path.startswith('.'):
        return ('rel', path)
    return ('ext', path)


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
            if name.endswith(('.ts', '.tsx')) and 'node_modules' not in name:
                listed.add(name)
    return sorted(listed)


def check_file(absolute):
    problems = []
    imports = []
    saw_blank = False
    with open(absolute, encoding='utf-8') as handle:
        lines = handle.read().split('\n')
    pending = None  # накопитель для многострочных import {\n ... \n} from '...'
    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if pending is not None:
            spec = _specifier(line)
            if spec is None:
                continue
            group, path = rank(spec)
            imports.append((pending[0], group, path, pending[1]))
            pending = None
            saw_blank = False
            continue
        if line == '':
            if imports or pending is not None:
                saw_blank = True
            continue
        # Комментарий между импортами (в т.ч. док-блок ТЗ) — нейтрален:
        # пустая строка до него сохраняется, иначе чекер врёт (проверено CI #85).
        if line.startswith('//') or line.startswith('/*') or line.startswith('*'):
            continue
        if not line.startswith('import'):
            saw_blank = False
            continue
        spec = _specifier(line)
        if spec is not None:
            group, path = rank(spec)
            imports.append((number, group, path, saw_blank))
            saw_blank = False
        else:
            # начало многострочного импорта — ждём строку с from '...'
            pending = (number, saw_blank)
            saw_blank = False
    for index in range(1, len(imports)):
        number, group, spec, blank = imports[index]
        _, previous_group, previous_spec, _ = imports[index - 1]
        if RANK_OF[group] < RANK_OF[previous_group]:
            problems.append(f'{absolute}:{number} группа раньше предыдущей: {spec}')
        elif RANK_OF[group] == RANK_OF[previous_group]:
            if blank:
                problems.append(f'{absolute}:{number} пустая строка внутри группы: {spec}')
            if spec.lower() < previous_spec.lower():
                problems.append(f'{absolute}:{number} не по алфавиту: {spec} < {previous_spec}')
        elif not blank:
            problems.append(f'{absolute}:{number} нет пустой строки между группами: {spec}')
    return problems


def main():
    root = subprocess.run(('git', 'rev-parse', '--show-toplevel'),
                          capture_output=True, text=True).stdout.strip()
    files = changed_files(root)
    problems = []
    checked = 0
    for relative in files:
        absolute = os.path.join(root, relative)
        if not os.path.isfile(absolute):
            print(f'пропущен (не найден): {relative}')
            continue
        checked += 1
        problems.extend(check_file(absolute))
    print(f'проверено файлов: {checked}, нарушений: {len(problems)}')
    for problem in problems:
        print('  ' + problem)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
