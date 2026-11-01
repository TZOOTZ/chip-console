import { describe, expect, it } from 'vitest'
import { useApp } from '../src/state/store'

describe('store.edit', () => {
  it('acepta recetas que devuelven un valor tras mutar (patrón (d) => (d.x = y))', () => {
    const st = useApp.getState()
    const before = st.song.bpm
    expect(() => st.edit((d) => (d.bpm = before + 7))).not.toThrow()
    expect(useApp.getState().song.bpm).toBe(before + 7)
    expect(() => useApp.getState().edit((d) => (d.title = 'PRUEBA'))).not.toThrow()
    expect(useApp.getState().song.title).toBe('PRUEBA')
  })

  it('undo/redo restauran y la coalescencia agrupa arrastres', () => {
    const st = useApp.getState()
    const start = st.song.bpm
    st.edit((d) => (d.bpm = start + 1), 'bpm')
    st.edit((d) => (d.bpm = start + 2), 'bpm')
    st.edit((d) => (d.bpm = start + 3), 'bpm')
    expect(useApp.getState().song.bpm).toBe(start + 3)
    useApp.getState().undo()
    expect(useApp.getState().song.bpm).toBe(start) // los tres cambios son una sola entrada de historial
    useApp.getState().redo()
    expect(useApp.getState().song.bpm).toBe(start + 3)
  })
})
