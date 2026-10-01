import { beforeEach, describe, expect, it } from 'vitest'

import { useUIStore } from '../src/stores/ui'

beforeEach(() => {
  useUIStore.setState({
    loginSheet: false,
    loginSheetMode: 'login',
    pendingGameSlug: null,
  })
})

describe('authentication sheet mode', () => {
  it('opens the registration sheet from the home page', () => {
    useUIStore.getState().openRegister()

    expect(useUIStore.getState().loginSheet).toBe(true)
    expect(useUIStore.getState().loginSheetMode).toBe('register')
    expect(useUIStore.getState().pendingGameSlug).toBeNull()
  })

  it('opens login mode for game launches and clears registration mode', () => {
    useUIStore.getState().openRegister()
    useUIStore.getState().openLogin('sample-game')

    expect(useUIStore.getState().loginSheet).toBe(true)
    expect(useUIStore.getState().loginSheetMode).toBe('login')
    expect(useUIStore.getState().pendingGameSlug).toBe('sample-game')
  })
})
