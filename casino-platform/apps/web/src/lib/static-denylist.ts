/**
 * Файлы, которые наружу отдавать нельзя.
 *
 * Причина не в том, что они «вредоносные», а в происхождении: вместе с донорскими
 * клиентами слотов в `apps/web/public/house/**` приехали исходники чужого бэкенда —
 * `api/endpoints/*.php` с логикой выплат, `api/inc/conf.inc.php` с подключением к
 * их базе и `web.php` с роутами Laravel. PHP у нас не исполняется (рантайма в стеке
 * нет), поэтому nginx и Next отдают это как обычный текст: любой может скачать
 * таблицу выплат чужой игры и чужие реквизиты БД.
 *
 * Удалить файлы нельзя, пока они остаются первоисточником нашей математики (на них
 * ссылаются комментарии в `house-slot-games.registry.ts`, `house-slot-game.ts` и
 * `originals-spin.use-case.ts`), и в git они не попадают намеренно — см. .gitignore.
 * Значит единственный верный шаг — перестать их отдавать.
 */
const DENIED_EXTENSIONS = [
  'php',
  'php3',
  'php4',
  'php5',
  'phtml',
  'phar',
  'inc',
  'sql',
  'env',
  'ini',
  'conf',
  'log',
  'bak',
  'old',
  'save',
  'swp',
  'sh',
  'bash',
  'py',
  'pl',
  'rb',
]

/** Точки доступа без расширения, которые тоже лежат в открытых папках. */
const DENIED_FILE_NAMES = ['.htaccess', '.htpasswd', '.env', '.git', '.gitignore']

function extensionOf(name: string): string {
  if (name.startsWith('.')) {
    return name.slice(1).toLowerCase()
  }
  const dot = name.lastIndexOf('.')
  return dot < 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Истина — для пути, который ведёт в служебный файл донорской сборки. Проверяется
 * только имя файла: каталоги игр (`/house/fortunetiger/1.png`) остаются открытыми.
 */
export function isDeniedPublicPath(pathname: string): boolean {
  const name = pathname.split('/').pop() ?? ''
  if (name.length === 0) {
    return false
  }
  if (DENIED_FILE_NAMES.includes(name.toLowerCase())) {
    return true
  }
  return name.includes('.') && DENIED_EXTENSIONS.includes(extensionOf(name))
}
