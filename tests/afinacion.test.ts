import { describe, expect, it } from 'vitest'
import { renderDrum } from '../src/engine/drums'
import { pitchOffset, VIB_FADE } from '../src/engine/synth'
import { renderSong } from '../src/export/render'
import { STYLES, generateSong, type StyleId } from '../src/music/generator'
import { PIECES, generatePiece, type PieceId } from '../src/music/piezas'
import { FM_PRESETS, PSG_PRESETS, createEmptySong } from '../src/music/presets'
import type { Song, Vibrato } from '../src/music/song'

const SR = 44100
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref)

/**
 * frecuencia por cruces por cero tras un paso-banda de 2º orden centrado en `f`. Con Q alto el segundo
 * armónico no se cuela aunque pese más que la fundamental (pasa en las cuerdas en el agudo)
 */
function zeroCross(x: Float32Array, f: number, a: number, b: number, q = 6): number {
  const w0 = (2 * Math.PI * f) / SR
  const al = Math.sin(w0) / (2 * q)
  const a0 = 1 + al
  const a1 = -2 * Math.cos(w0)
  const a2 = 1 - al
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = (al * x[i] - al * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  const cr: number[] = []
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) if (y[i - 1] < 0 && y[i] >= 0) cr.push(i - 1 + -y[i - 1] / (y[i] - y[i - 1]))
  return (SR * (cr.length - 1)) / (cr[cr.length - 1] - cr[0])
}

/** una nota larga sin vibrato ni envolvente de pitch */
function steady(kind: 'fm' | 'psg', inst: number, note: number): Float32Array {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 2
  for (const p of [...s.fmBank, ...s.psgBank]) {
    delete p.vib
    delete p.pitchEnv
  }
  const id = kind === 'fm' ? 'fm1' : 'sq1'
  const tr = s.tracks.find((t) => t.id === id)!
  tr.inst = inst
  tr.gate = 1
  s.patterns[0].notes[id] = [{ step: 0, len: 16, note, vel: 13 }]
  return renderSong(s, { sampleRate: SR, tail: 0.1 }).left
}

/** instrumentos cuyo vibrato es un efecto (zumbido, temblor, destello) y no la afinación de una voz */
const EFFECT_VIB = new Set(['THEREMIN', 'PONTICELLO', 'PARARRAYOS', 'TWINKLE'])

describe('afinación de los chips', () => {
  it('cada voz melódica del FM suena en su nota (±3 cents) en todo el registro', () => {
    // los que llevan dos portadoras reparten el detune a los dos lados (−1/+1) para que el centro quede en la nota
    const melodic = ['SINE SUB', 'RHODES', 'SAW LEAD', 'SQUARE LEAD', 'BRASS', 'FLUTE', 'STRINGS', 'CHOIR', 'ORGAN', 'SOLINA', 'COSMIC LEAD', 'SAX', 'VIOLIN', 'VIOLINS', 'CELLO', 'TROMPETA', 'TROMPA', 'TUBA', 'OBOE']
    for (const name of melodic) {
      const i = FM_PRESETS.findIndex((p) => p.name === name)
      for (const note of [36, 48, 60, 72, 84]) {
        const x = steady('fm', i, note)
        const c = cents(zeroCross(x, midiHz(note), 0.2, 0.6, 24), midiHz(note))
        expect(Math.abs(c), `${name} ${note}: ${c.toFixed(1)} cents`).toBeLessThan(3)
      }
    }
  })

  it('el PSG da la nota exacta (±3 cents) hasta Do6', () => {
    for (const note of [48, 60, 72, 84]) {
      const x = steady('psg', 0, note)
      const c = cents(zeroCross(x, midiHz(note), 0.2, 0.6), midiHz(note))
      expect(Math.abs(c), `PSG ${note}: ${c.toFixed(1)} cents`).toBeLessThan(3)
    }
  })

  it('los timbales afinados suenan en la tónica y en la dominante de cada tonalidad', () => {
    for (const key of [0, 4, 7, 11]) {
      const s = generatePiece({ piece: 'maestoso', seed: 1, key, mode: 'major' })
      const tonic = 45 + ((key - 9 + 12) % 12)
      for (const [voice, note] of [[3, tonic], [2, tonic - 5]]) {
        const f = zeroCross(renderDrum(s.drumKit[voice], SR), midiHz(note), 0.08, 0.3)
        // el parche arranca algo alto y se destensa: 0-6 cents en esa ventana
        expect(cents(f, midiHz(note)), `${s.drumKit[voice].name} en tónica ${key}`).toBeGreaterThan(-2)
        expect(cents(f, midiHz(note)), `${s.drumKit[voice].name} en tónica ${key}`).toBeLessThan(7)
      }
    }
  })
})

describe('vibrato de conjunto', () => {
  it('la fase sigue el reloj común: dos voces a la misma velocidad oscilan juntas aunque ataquen en momentos distintos', () => {
    const a: Vibrato = { delay: 18, rate: 5.5, depth: 12 }
    const b: Vibrato = { delay: 0, rate: 5.5, depth: 12 }
    for (let clock = 200; clock < 400; clock++) {
      // una ataca en el frame 100 y la otra en el 170: pasada la rampa, la misma desviación
      const da = pitchOffset(a, undefined, clock - 100, clock)
      const db = pitchOffset(b, undefined, clock - 170, clock)
      expect(Math.abs(da - db)).toBeLessThan(1e-9)
    }
  })

  it('pasado el retardo, la profundidad entra en rampa (sin saltos de afinación)', () => {
    const v: Vibrato = { delay: 18, rate: 5.5, depth: 12 }
    for (let age = 0; age < 18; age++) expect(pitchOffset(v, undefined, age, 1000 + age)).toBe(0)
    // el primer frame con vibrato apenas se aparta, y nunca salta más de lo que se mueve el propio vibrato
    expect(Math.abs(pitchOffset(v, undefined, 18, 1018))).toBeLessThanOrEqual(12 / VIB_FADE + 1e-9)
    const slope = (2 * Math.PI * 5.5 * 12) / 60 + 12 / VIB_FADE
    let prev = 0
    for (let age = 18; age < 18 + VIB_FADE + 30; age++) {
      const c = pitchOffset(v, undefined, age, 1000 + age)
      expect(Math.abs(c - prev)).toBeLessThanOrEqual(slope)
      expect(Math.abs(c)).toBeLessThanOrEqual(12 + 1e-9)
      prev = c
    }
  })

  it('los vibratos de voz comparten velocidad (5,5 Hz) y retardo, y no pasan de ±12 cents', () => {
    for (const p of [...FM_PRESETS, ...PSG_PRESETS]) {
      if (!p.vib || EFFECT_VIB.has(p.name)) continue
      expect(p.vib.rate, p.name).toBe(5.5)
      expect([0, 18], p.name).toContain(p.vib.delay)
      expect(p.vib.depth, p.name).toBeLessThanOrEqual(12)
    }
  })
})

/** desviación máxima (cents) entre dos voces que se doblan al unísono o a la octava, por sus vibratos */
function doublingSpread(s: Song): number {
  const spb = s.beatsPerBar * 4
  const fps = 3600 / (s.bpm * 4)
  const ev: { tr: string; a: number; b: number; p: number; vib?: Vibrato }[] = []
  let off = 0
  for (const pid of s.order) {
    const p = s.patterns.find((x) => x.id === pid)!
    for (const t of s.tracks) {
      if (t.kind === 'dac' || t.kind === 'noise') continue
      const inst = t.kind === 'fm' ? s.fmBank[t.inst] : s.psgBank[t.inst]
      if (EFFECT_VIB.has(inst.name)) continue
      for (const n of p.notes[t.id] ?? []) ev.push({ tr: t.id, a: (off + n.step) * fps, b: (off + n.step + n.len * Math.min(1, t.gate)) * fps, p: n.note + t.transpose, vib: inst.vib })
    }
    off += p.bars * spb
  }
  let worst = 0
  for (let i = 0; i < ev.length; i++) {
    for (let j = i + 1; j < ev.length; j++) {
      const x = ev[i]
      const y = ev[j]
      if (x.tr === y.tr || Math.abs(x.p - y.p) % 12) continue
      for (let f = Math.ceil(Math.max(x.a, y.a)); f < Math.min(x.b, y.b); f += 2) {
        worst = Math.max(worst, Math.abs(pitchOffset(x.vib, undefined, f - x.a, f) - pitchOffset(y.vib, undefined, f - y.a, f)))
      }
    }
  }
  return worst
}

describe('doblajes afinados', () => {
  it('en las piezas y los estilos, dos voces dobladas nunca se separan más de 12 cents', () => {
    for (const pc of PIECES) expect(doublingSpread(generatePiece({ piece: pc.id as PieceId, seed: 222, key: 2 })), pc.id).toBeLessThanOrEqual(12.01)
    for (const st of STYLES) expect(doublingSpread(generateSong({ style: st.id as StyleId, seed: 222, key: 2, bars: 4 })), st.id).toBeLessThanOrEqual(12.01)
  })
})
