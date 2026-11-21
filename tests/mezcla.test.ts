import { describe, expect, it } from 'vitest'
import { integratedLufs } from '../src/export/loudness'
import { measureRoles } from '../src/export/medirMezcla'
import { generateSong } from '../src/music/generator'
import { ROLE_TARGET, applyMix, roleOf, targetFor, trimFor } from '../src/music/mezcla'
import { MIX_TRIMS } from '../src/music/mezcla-tabla'
import { PIECES, generatePiece } from '../src/music/piezas'
import { STYLES } from '../src/music/generator'
import { createEmptySong } from '../src/music/presets'

describe('sonoridad (BS.1770)', () => {
  it('un seno de 997 Hz a −20 dBFS en los dos canales mide −20 LUFS', () => {
    const sr = 48000
    const x = new Float32Array(sr * 3)
    for (let i = 0; i < x.length; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 997 * i) / sr)
    expect(integratedLufs(x, x, sr)).toBeCloseTo(-20, 1)
    // en un solo canal, 3 dB menos
    expect(integratedLufs(x, new Float32Array(x.length), sr)).toBeCloseTo(-23.01, 1)
  })

  it('el silencio no tiene sonoridad', () => {
    const z = new Float32Array(44100)
    expect(integratedLufs(z, z, 44100)).toBe(-Infinity)
  })
})

describe('mezcla por roles', () => {
  it('cada pista tiene su rol: la convención de pistas y las excepciones de cada generador', () => {
    const s = createEmptySong()
    const t = (id: string) => s.tracks.find((x) => x.id === id)!
    expect(roleOf('cosmic', t('fm4'))).toBe('lead')
    expect(roleOf('cosmic', t('fm1'))).toBe('bass')
    expect(roleOf('cosmic', t('fm2'))).toBe('harmony')
    expect(roleOf('cosmic', t('sq2'))).toBe('echo')
    expect(roleOf('fanfare', t('sq1'))).toBe('double')
    expect(roleOf('maestoso', t('ch6'))).toBe('perc')
    // los dobles y los colores van detrás de la armonía, y todo detrás del tema
    expect(ROLE_TARGET.double).toBeLessThan(ROLE_TARGET.harmony)
    expect(Math.max(...Object.values(ROLE_TARGET))).toBe(ROLE_TARGET.lead)
  })

  it('la tabla tiene una entrada por estilo y pieza y no sube nada por encima de 100', () => {
    for (const id of [...STYLES.map((s) => s.id), ...PIECES.map((p) => p.id)]) expect(MIX_TRIMS[id], id).toBeDefined()
    for (const g of STYLES.map((s) => s.id)) {
      const song = generateSong({ style: g, seed: 9, key: 3 })
      for (const t of song.tracks) {
        expect(t.vol).toBeGreaterThanOrEqual(1)
        expect(t.vol).toBeLessThanOrEqual(100)
      }
    }
  })

  it('applyMix mueve el volumen de pista lo que dice la tabla (con la pista sola como respaldo)', () => {
    const s = createEmptySong()
    s.tracks.forEach((t) => (t.vol = 80))
    MIX_TRIMS.__prueba = { 'fm2:E-PIANO': -6, fm3: 20, sq1: -60 }
    s.tracks.find((t) => t.id === 'fm2')!.inst = 4 // E-PIANO
    try {
      expect(trimFor('__prueba', s, s.tracks.find((t) => t.id === 'fm2')!)).toBe(-6)
      applyMix(s, '__prueba')
      expect(s.tracks.find((t) => t.id === 'fm2')!.vol).toBe(40)
      expect(s.tracks.find((t) => t.id === 'fm3')!.vol).toBe(100)
      expect(s.tracks.find((t) => t.id === 'sq1')!.vol).toBe(1)
      expect(s.tracks.find((t) => t.id === 'fm4')!.vol).toBe(80)
    } finally {
      delete MIX_TRIMS.__prueba
    }
  })

  it('medido en temas que no se usaron para la tabla, ningún acompañamiento se come al tema', () => {
    const songs = [
      ['cosmic', generateSong({ style: 'cosmic', seed: 777, key: 4 })],
      ['maestoso', generatePiece({ piece: 'maestoso', seed: 777, key: 4 })],
    ] as const
    for (const [gen, song] of songs) {
      const rs = measureRoles(gen, song, 16, 16000)
      expect(rs.length, gen).toBeGreaterThan(4)
      for (const r of rs) {
        // nada más de 3,5 LU por encima de su objetivo
        expect(r.rel - targetFor(gen, r.role), `${gen} ${r.key} (${r.role}) ${r.rel.toFixed(1)} LU`).toBeLessThan(3.5)
        // y todo lo que no es bajo ni batería, por debajo del tema
        if (r.role !== 'bass' && r.role !== 'drums') expect(r.rel, `${gen} ${r.key}`).toBeLessThan(-3)
      }
    }
  }, 60000)
})
