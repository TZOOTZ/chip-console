import { describe, expect, it } from 'vitest'
import { stepTick } from '../src/export/midi'
import { packSong, songFromHash, songToHash, unpackSong } from '../src/export/share'
import { captureWrites } from '../src/export/vgm'
import { createEmptySong } from '../src/music/presets'
import { emptyPattern, sanitizeSong, type Song } from '../src/music/song'

/** tema con un golpe de bombo en cada paso 0-4 */
function clicks(swing: number, grid: number): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.swing = swing
  s.swingGrid = grid
  s.patterns = []
  s.order = []
  const p = emptyPattern(s, 1, 'A')
  p.notes.ch6 = [0, 1, 2, 3, 4].map((step) => ({ step, len: 1, note: 0, vel: 15 }))
  s.patterns.push(p)
  s.order.push(p.id)
  s.loopStart = -1
  return s
}

/** instantes (en pasos de rejilla recta) en que suena cada golpe */
function onsets(song: Song): number[] {
  const base = (44100 * 60) / (song.bpm * 4)
  const cap = captureWrites(song, 0.1)
  const out: number[] = []
  for (let i = 0; i < cap.drums.length; i += 3) out.push(cap.drums[i] / base)
  return out
}

describe('swing sobre semicorcheas o sobre corcheas', () => {
  it('con celda de 2 pasos se balancean las parejas de semicorcheas (como siempre)', () => {
    const t = onsets(clicks(0.5, 2))
    expect(t.map((x) => Math.round(x * 100) / 100)).toEqual([0, 1.5, 2, 3.5, 4])
  })

  it('con celda de 4 pasos se balancean las parejas de corcheas: el contratiempo cae en 2 + 2·swing', () => {
    const t = onsets(clicks(0.5, 4))
    // los pasos 0 y 1 duran 1,5 y los 2 y 3 duran 0,5: el contratiempo (paso 2) llega en 3, el paso 3 en 3,5 y la negra siguiente en 4
    expect(t.map((x) => Math.round(x * 100) / 100)).toEqual([0, 1.5, 3, 3.5, 4])
    // con 1/3 sale el tresillo de jazz: el contratiempo de la corchea en 2·(1 + 1/3)
    const j = onsets(clicks(1 / 3, 4))
    expect(j[2]).toBeCloseTo(8 / 3, 1)
    expect(j[4]).toBeCloseTo(4, 1)
  })

  it('un mismo compás dura lo mismo con o sin swing', () => {
    for (const grid of [2, 4]) {
      const a = onsets(clicks(0, grid))
      const b = onsets(clicks(0.4, grid))
      expect(b[4]).toBeCloseTo(a[4], 1)
    }
  })

  it('el MIDI lleva el swing metido en los ticks (480 por negra) y con la opción recta, no', () => {
    const g2 = { swing: 0.5, swingGrid: 2 }
    expect([0, 1, 2, 3].map((s) => stepTick(g2, s))).toEqual([0, 180, 240, 420])
    const g4 = { swing: 0.5, swingGrid: 4 }
    expect([0, 1, 2, 3, 4].map((s) => stepTick(g4, s))).toEqual([0, 180, 360, 420, 480])
    expect([0, 1, 2, 3].map((s) => stepTick(g4, s, true))).toEqual([0, 120, 240, 360])
    // sin swing no cambia nada respecto a la rejilla
    expect([0, 1, 2, 3, 7].map((s) => stepTick({ swing: 0, swingGrid: 4 }, s))).toEqual([0, 120, 240, 360, 840])
  })

  it('swingGrid se guarda en el enlace y en el proyecto; el 2 (por defecto) no ocupa sitio y los temas viejos lo traen en 2', () => {
    const s = clicks(0.33, 4)
    expect(songFromHash(songToHash(s)).swingGrid).toBe(4)
    expect(unpackSong(packSong(s)).swingGrid).toBe(4)
    expect('sg' in packSong(clicks(0.33, 2))).toBe(false)
    expect(songFromHash(songToHash(clicks(0.33, 2))).swingGrid).toBe(2)
    const old = JSON.parse(JSON.stringify(clicks(0.2, 2))) as Record<string, unknown>
    delete old.swingGrid
    expect(sanitizeSong(old, createEmptySong()).swingGrid).toBe(2)
    expect(sanitizeSong({ ...old, swingGrid: 3 }, createEmptySong()).swingGrid).toBe(2)
    expect(sanitizeSong({ ...old, swingGrid: 4 }, createEmptySong()).swingGrid).toBe(4)
  })
})
