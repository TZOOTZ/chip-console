// ── Presupuesto de ROM: las medidas y las reglas sobre canciones hechas a mano ──
import { describe, expect, it } from 'vitest'
import { BANCO_LIBRE_KB, MS_POR_KB, auditarPresupuesto, fmtBytes, reglas } from '../src/export/presupuesto'
import { KIT_909 } from '../src/music/electro'
import { createEmptySong } from '../src/music/presets'
import { emptyPattern, type Note, type Song } from '../src/music/song'

/** una canción de `bars` compases con las notas dadas por pista; el kit es el 909 salvo que se cambie */
function build(bars: number, notes: Record<string, Note[]>, edit?: (s: Song) => void): Song {
  const s = createEmptySong()
  s.patterns = []
  s.order = []
  s.drumKit = KIT_909.map((v) => ({ ...v }))
  s.bpm = 120
  s.swing = 0
  const p = emptyPattern(s, bars, 'A')
  for (const [id, list] of Object.entries(notes)) p.notes[id] = list
  s.patterns.push(p)
  s.order.push(p.id)
  s.loopStart = -1
  edit?.(s)
  return s
}
const n = (step: number, note: number, vel: number, len = 1): Note => ({ step, len, note, vel })
const failed = (s: Song): number[] => reglas(auditarPresupuesto(s)).filter((r) => !r.ok).map((r) => r.n)

describe('auditarPresupuesto', () => {
  it('cuenta lo que ocupa: música, muestras y escrituras', () => {
    const s = build(2, { fm1: [n(0, 36, 12, 4), n(8, 43, 12, 4)], ch6: [n(0, 0, 15), n(8, 1, 9)] })
    const p = auditarPresupuesto(s)
    expect(p.bytesXgc).toBe(p.bytesMuestras + p.bytesMusica + 0x104)
    expect(p.bytesMuestras).toBeGreaterThan(0)
    expect(p.bytesMusica).toBeGreaterThan(0)
    expect(p.bytesMusicaLz).toBeLessThan(p.bytesMusica * 2)
    expect(p.segundos).toBeCloseTo(4, 5) // 2 compases a 120 BPM
    expect(p.voces.map((v) => [v.slot, v.golpes, v.niveles])).toEqual([[0, 1, [0]], [1, 1, [1]]])
    expect(p.muestras).toBe(2)
    expect(p.propias).toBe(0)
  })

  it('los sonidos del 909 no cuestan nada propio; uno distinto, sí, y lo mide en ms y KB', () => {
    const s = build(1, { ch6: [n(0, 0, 15), n(4, 5, 9)] }, (song) => {
      // un timbal seco en la casilla de la conga grave
      song.drumKit[5] = { name: 'TIMBAL', kind: 'timp', pitch: 0.3, decay: 0, tone: 0.5, gain: 0.9 }
    })
    const p = auditarPresupuesto(s)
    expect(p.propias).toBe(1)
    expect(p.voces.find((v) => v.slot === 5)!.propia).toBe(true)
    expect(p.voces.find((v) => v.slot === 0)!.propia).toBe(false)
    expect(p.propiasMs).toBeGreaterThanOrEqual(215)
    expect(p.propiasKB).toBeCloseTo(p.propiasMs / MS_POR_KB, 6)
    expect(p.propiasKB).toBeLessThan(BANCO_LIBRE_KB)
  })

  it('el intro y la coda se leen del orden', () => {
    const s = build(4, { fm1: [n(0, 36, 12, 16)] }, (song) => {
      const intro = emptyPattern(song, 2, 'INTRO')
      song.patterns.unshift(intro)
      const outro = emptyPattern(song, 2, 'OUTRO')
      song.patterns.push(outro)
      song.order = [intro.id, song.patterns[1].id, outro.id]
      song.loopStart = 1
    })
    const p = auditarPresupuesto(s)
    expect(p.bucle).toBe(true)
    expect(p.compasesIntro).toBe(2)
    expect(p.coda).toBe(true)
    expect(p.segundosBucle).toBeCloseTo(12, 5) // 4 + 2 compases a 2 s
  })
})

describe('reglas', () => {
  it('una canción limpia las cumple todas', () => {
    const s = build(4, { fm1: [n(0, 36, 12, 8), n(16, 41, 12, 8)], sq1: [n(0, 72, 12, 2), n(8, 76, 12, 2)], ch6: [n(0, 0, 15), n(8, 1, 15), n(4, 2, 9)] }, (song) => {
      // el bajo de PSG de fábrica: sin vibrato y con cuatro pasos de envolvente
      song.tracks.find((t) => t.id === 'sq1')!.inst = 5
    })
    expect(failed(s)).toEqual([])
  })

  it('1 · más de tres sonidos propios, o más de lo que cabe, incumple', () => {
    const s = build(1, { ch6: [n(0, 0, 15), n(2, 1, 15), n(4, 2, 9), n(6, 3, 9)] }, (song) => {
      for (const i of [0, 1, 2, 3]) song.drumKit[i] = { ...song.drumKit[i], name: 'PROPIO', gain: 0.5 }
    })
    expect(failed(s)).toContain(1)
  })

  it('2 · un golpe propio más largo que su tope incumple', () => {
    const s = build(1, { ch6: [n(0, 0, 15)] }, (song) => {
      song.drumKit[0] = { name: 'KICK LARGO', kind: 'kick', pitch: 0.4, decay: 0.9, tone: 0.5, gain: 1 }
    })
    expect(failed(s)).toContain(2)
    // y a 0 de decaimiento (140 ms) entra
    const ok = build(1, { ch6: [n(0, 0, 15)] }, (song) => {
      song.drumKit[0] = { name: 'KICK CORTO', kind: 'kick', pitch: 0.4, decay: 0, tone: 0.5, gain: 1 }
    })
    expect(failed(ok)).not.toContain(2)
  })

  it('3 · un sonido a tres niveles de velocidad incumple', () => {
    const s = build(1, { ch6: [n(0, 0, 15), n(4, 0, 9), n(8, 0, 5)] })
    expect(failed(s)).toContain(3)
  })

  it('4 · percusión corta en el ruido incumple; el mar (nota larga) no', () => {
    const hats = build(1, { noise: [n(0, 0, 8), n(2, 0, 8), n(4, 2, 8)] })
    expect(failed(hats)).toContain(4)
    const sea = build(2, { noise: [n(0, 4, 8, 24)] })
    expect(failed(sea)).not.toContain(4)
  })

  it('5 · una envolvente de PSG de muchos pasos incumple', () => {
    // el pluck de fábrica baja diez pasos de volumen por nota
    const s = build(2, { sq1: [n(0, 72, 15, 2), n(4, 72, 15, 2), n(8, 72, 15, 2), n(12, 72, 15, 2)] }, (song) => {
      song.tracks.find((t) => t.id === 'sq1')!.inst = 1
    })
    expect(failed(s)).toContain(5)
  })

  it('6 · dos notas a la vez en una pista FM (arpegio a 60 Hz) incumple', () => {
    const s = build(1, { fm2: [n(0, 60, 12, 8), n(0, 64, 12, 8), n(0, 67, 12, 8)] })
    expect(failed(s)).toContain(6)
  })

  it('7 · el vibrato incumple salvo en la pista que es la firma', () => {
    const s = build(1, { sq1: [n(0, 72, 12, 8)] }, (song) => {
      song.psgBank[0].vib = { delay: 0, rate: 5, depth: 20 }
      song.tracks.find((t) => t.id === 'sq1')!.inst = 0
    })
    const p = auditarPresupuesto(s)
    expect(p.modulacion).toContain('sq1 vibrato')
    expect(reglas(p).find((r) => r.n === 7)!.ok).toBe(false)
    expect(reglas(p, { firma: ['sq1'] }).find((r) => r.n === 7)!.ok).toBe(true)
  })

  it('10 · una intro larga o una coda con bucle incumplen', () => {
    const s = build(8, { fm1: [n(0, 36, 12, 8)] }, (song) => {
      const a = song.patterns[0]
      const intro = emptyPattern(song, 8, 'INTRO')
      song.patterns.unshift(intro)
      song.order = [intro.id, a.id]
      song.loopStart = 1
    })
    expect(failed(s)).toContain(10)
  })
})

describe('fmtBytes', () => {
  it('bytes sueltos y kilobytes', () => {
    expect(fmtBytes(341)).toBe('341 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
  })
})
