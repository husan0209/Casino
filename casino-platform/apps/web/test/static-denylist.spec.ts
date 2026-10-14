import { describe, expect, it } from 'vitest'

import { isDeniedPublicPath } from '@/lib/static-denylist'

/**
 * Список проверяется на двух концах сразу: на том, что файлы донорского бэкенда
 * действительно не отдаются, и на том, что блокировка не съедает саму игру. Если
 * кто-то расширит список до «jpg» или «json», игра перестанет грузиться, и этот
 * спек должен покраснеть раньше, чем это увидит игрок.
 */
describe('isDeniedPublicPath (donor backend files must not be served)', () => {
  it('-blocks donor server sources that ship inside the game folders', () => {
    expect(isDeniedPublicPath('/house/queenofbounty/api/endpoints/spin.php')).toBe(true)
    expect(isDeniedPublicPath('/house/queenofbounty/api/endpoints/spin_data/wins.php')).toBe(true)
    expect(isDeniedPublicPath('/house/bikiniparadise/api/inc/conf.inc.php')).toBe(true)
    expect(isDeniedPublicPath('/house/fortunemouse/images/web.php')).toBe(true)
    expect(isDeniedPublicPath('/house/queenofbounty/api/inc/functions.inc')).toBe(true)
    expect(isDeniedPublicPath('/house/queenofbounty/.env')).toBe(true)
    expect(isDeniedPublicPath('/house/queenofbounty/api/index.php5')).toBe(true)
  })

  it('does not touch anything the game actually loads', () => {
    for (const path of [
      '/house/fortunetiger/index.html',
      '/house/fortunetiger/data.json',
      '/house/fortunetiger/avatar.atlas',
      '/house/fortunetiger/images/web2.png',
      '/house/fortunetiger/scripts/c3runtime.js',
      '/house/fortunetiger/gamerule.css',
      '/house/fortunetiger/gamerule.txt',
      '/house/fortunetiger/cover.jpg',
      '/house/plinko/index.html',
      '/casino/plinko',
      '/',
    ]) {
      expect(isDeniedPublicPath(path), path).toBe(false)
    }
  })

  it('is case insensitive and looks only at the file name', () => {
    expect(isDeniedPublicPath('/house/X/API/Spin.PHP')).toBe(true)
    expect(isDeniedPublicPath('/php/fortunetiger/data.json')).toBe(false)
  })
})
