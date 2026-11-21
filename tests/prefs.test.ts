import { afterEach, describe, expect, it } from 'vitest'
import { loadPrefs, savePrefs } from '../src/state/store'

const KEY = 'tz-megadrive:prefs'
const store = new Map<string, string>()
const g = globalThis as { localStorage?: unknown }
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

describe('ajustes guardados: sonido por defecto', () => {
  afterEach(() => store.clear())

  it('sin nada guardado suena LIMPIO', () => {
    expect(loadPrefs().sound).toBe('clean')
  })

  it('un MODEL 1 guardado antes del cambio (sin versión) pasa a LIMPIO; el resto de ajustes se conserva', () => {
    store.set(KEY, JSON.stringify({ sound: 'md1', crt: false, dock: 'bottom' }))
    const p = loadPrefs()
    expect(p.sound).toBe('clean')
    expect(p.crt).toBe(false)
    expect(p.dock).toBe('bottom')
  })

  it('lo elegido después del cambio se respeta, también MODEL 1', () => {
    savePrefs({ ...loadPrefs(), sound: 'md1' })
    expect(JSON.parse(store.get(KEY)!).soundV).toBe(2)
    expect(loadPrefs().sound).toBe('md1')
  })
})
