import { describe, expect, it } from 'vitest'
import { renderDrum } from '../src/engine/drums'
import { renderSong } from '../src/export/render'
import { generateSong } from '../src/music/generator'
import { FM_PRESETS, createEmptySong } from '../src/music/presets'
import type { DrumVoice, Note, Song } from '../src/music/song'
import { scaleById } from '../src/music/theory'
import { db, magnitudeSpectrum, rms } from './helpers'

const SR = 44100
const fmIndex = (name: string): number => FM_PRESETS.findIndex((p) => p.name === name)
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

function oneNote(inst: number, note: number, steps: number, vel = 12): Float32Array {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 2
  s.tracks[0].inst = inst
  s.tracks[0].gate = 1
  s.patterns[0].notes.fm1 = [{ step: 0, len: steps, note, vel }]
  return renderSong(s, { sampleRate: SR, tail: 0.3 }).left
}

/** RMS en ventanas de 20 ms */
function envelope(x: Float32Array): number[] {
  const w = 882
  const out: number[] = []
  for (let i = 0; i + w <= x.length; i += w) {
    let e = 0
    for (let k = 0; k < w; k++) e += x[i + k] * x[i + k]
    out.push(Math.sqrt(e / w))
  }
  return out
}

/** ms hasta el 90 % del máximo */
const attackMs = (x: Float32Array): number => {
  const env = envelope(x)
  const mx = Math.max(...env)
  return env.findIndex((e) => e >= 0.9 * mx) * 20
}

/** nivel de los armónicos 1-n, en dB sobre el primero */
function harmonics(x: Float32Array, at: number, f0: number, n: number): number[] {
  const len = 4096
  const from = Math.round(at * SR)
  const amp: number[] = []
  for (let k = 1; k <= n; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < len; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1))
      const ph = (2 * Math.PI * k * f0 * i) / SR
      re += x[from + i] * w * Math.cos(ph)
      im += x[from + i] * w * Math.sin(ph)
    }
    amp.push(Math.hypot(re, im))
  }
  return amp.map((a) => db(a / amp[0]))
}

/** fracción de la energía por debajo de `lo` Hz y por encima de `hi` Hz */
function bandShare(x: Float32Array, lo: number, hi: number): [number, number] {
  const size = 1 << 15
  const mag = magnitudeSpectrum(x.subarray(0, Math.min(x.length, size)), size)
  let low = 0
  let high = 0
  let tot = 0
  for (let i = 1; i < mag.length; i++) {
    const f = (i * SR) / size
    const e = mag[i] * mag[i]
    tot += e
    if (f < lo) low += e
    if (f > hi) high += e
  }
  return [low / tot, high / tot]
}

const voice = (kind: DrumVoice['kind'], pitch: number, decay: number, tone: number): DrumVoice => ({ name: kind, kind, pitch, decay, tone, gain: 0.9 })

describe('cuerdas de arco', () => {
  it('van al final del banco, detrás del jazz, sin mover nada de lo anterior', () => {
    expect(FM_PRESETS.slice(29).map((p) => p.name)).toEqual(['VIOLIN', 'VIOLINS', 'PIZZICATO', 'SPICCATO', 'PONTICELLO', 'CELLO', 'RAYO', 'PARARRAYOS'])
    expect(fmIndex('VIBES')).toBe(28)
  })

  it('el violín es una cuerda frotada: arco de 20-80 ms y armónicos que caen poco a poco', () => {
    const x = oneNote(fmIndex('VIOLIN'), 69, 12)
    expect(attackMs(x)).toBeGreaterThanOrEqual(20)
    expect(attackMs(x)).toBeLessThanOrEqual(80)
    const h = harmonics(x, 0.4, midiHz(69), 6)
    // hasta el sexto armónico se oye (diente de sierra), y ninguno manda sobre la fundamental
    for (let k = 1; k < 6; k++) {
      expect(h[k], `armónico ${k + 1}`).toBeGreaterThan(-30)
      expect(h[k], `armónico ${k + 1}`).toBeLessThan(0)
    }
  })

  it('la sección entra más despacio que el solista y el chelo canta grave con la segunda armónica marcada', () => {
    expect(attackMs(oneNote(fmIndex('VIOLINS'), 67, 12))).toBeGreaterThan(attackMs(oneNote(fmIndex('VIOLIN'), 67, 12)))
    const h = harmonics(oneNote(fmIndex('CELLO'), 43, 12), 0.4, midiHz(43), 3)
    expect(h[1]).toBeGreaterThan(-6)
  })

  it('el pizzicato se apaga solo y el spiccato es corto', () => {
    for (const name of ['PIZZICATO', 'SPICCATO']) {
      const env = envelope(oneNote(fmIndex(name), 67, 12))
      const mx = Math.max(...env)
      // a los 400 ms ya ha caído más de 15 dB, aunque la nota siga pulsada
      expect(db(env[20] / mx), name).toBeLessThan(-15)
    }
  })
})

describe('electricidad', () => {
  it('rayo: un chasquido agudo y corto', () => {
    const x = renderDrum(voice('bolt', 0.5, 0.5, 0.6), SR)
    expect(x.length / SR).toBeLessThan(1)
    const [low, high] = bandShare(x, 300, 2000)
    expect(high).toBeGreaterThan(0.5)
    expect(low).toBeLessThan(0.1)
  })

  it('trueno: muy grave, largo, se oscurece y se apaga, sin subsónico', () => {
    const x = renderDrum(voice('thunder', 0.4, 0.6, 0.5), SR)
    expect(x.length / SR).toBeGreaterThan(3)
    const [low] = bandShare(x, 150, 2000)
    expect(low).toBeGreaterThan(0.75)
    const [sub] = bandShare(x, 25, 20000)
    expect(sub).toBeLessThan(0.015)
    // el golpe tiene cuerpo y la cola es más honda y bastante más floja
    const q = Math.floor(x.length / 4)
    const head = x.subarray(0, q)
    const tail = x.subarray(3 * q)
    expect(bandShare(head, 100, 2000)[1]).toBeGreaterThan(bandShare(tail, 100, 2000)[1] * 2)
    expect(db(rms(tail)) - db(rms(head))).toBeLessThan(-10)
  })

  it('chispazo: un zumbido de impulsos a la frecuencia pedida', () => {
    const x = renderDrum(voice('arc', 0.3, 0.6, 0.2), SR)
    const f = 50 + 170 * 0.3
    // autocorrelación: el periodo del zumbido destaca sobre medio periodo
    const seg = x.subarray(Math.round(0.05 * SR), Math.round(0.35 * SR))
    const ac = (lag: number): number => {
      let s = 0
      for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag]
      return s
    }
    const period = Math.round(SR / f)
    expect(ac(period)).toBeGreaterThan(ac(Math.round(period / 2)))
  })

  it('el rayo de FM cae en picado y el pararrayos zumba sostenido', () => {
    const rayo = envelope(oneNote(fmIndex('RAYO'), 72, 12, 15))
    expect(db(rayo[40] / Math.max(...rayo))).toBeLessThan(-15)
    const zumbido = envelope(oneNote(fmIndex('PARARRAYOS'), 40, 12))
    expect(db(zumbido[50] / Math.max(...zumbido))).toBeGreaterThan(-3)
  })
})

describe('TORMENTA', () => {
  const songs: Song[] = [1, 7, 2024, 5].map((seed) => generateSong({ style: 'storm', seed, key: seed % 12 }))
  const notesOf = (s: Song, pat: string, track: string): Note[] => s.patterns.find((p) => p.name === pat)?.notes[track] ?? []

  it('el kit lleva el rayo, el trueno y el chispazo, y la orquesta es de cuerda', () => {
    for (const s of songs) {
      expect(s.drumKit.map((d) => d.kind)).toEqual(expect.arrayContaining(['bolt', 'thunder', 'arc', 'timp']))
      const insts = s.tracks.filter((t) => t.kind === 'fm').map((t) => s.fmBank[t.inst].name)
      expect(insts).toEqual(expect.arrayContaining(['CELLO', 'SPICCATO', 'VIOLIN', 'PARARRAYOS']))
    }
  })

  it('cae el rayo al entrar cada sección fuerte y el trueno llega después', () => {
    for (const s of songs) {
      const rayo = s.drumKit.findIndex((d) => d.kind === 'bolt')
      const trueno = s.drumKit.findIndex((d) => d.kind === 'thunder')
      for (const name of ['A', 'B', 'FINAL']) {
        const ch6 = notesOf(s, name, 'ch6')
        const strike = ch6.find((n) => n.note === rayo)
        expect(strike?.step, `${s.title} ${name}`).toBe(0)
        const after = ch6.filter((n) => n.note === trueno && n.step > 0)
        expect(after.length, `${s.title} ${name}: trueno`).toBeGreaterThan(0)
      }
    }
  })

  it('el pararrayos se carga: sube ligado y los chispazos se apiñan antes del rayo', () => {
    for (const s of songs) {
      const arc = s.drumKit.findIndex((d) => d.kind === 'arc')
      for (const name of ['INTRO', 'BRK']) {
        const pat = s.patterns.find((p) => p.name === name)!
        const from = (pat.bars - 2) * 16
        const rise = notesOf(s, name, 'fm5').filter((n) => n.step >= from)
        expect(rise.length).toBeGreaterThan(8)
        for (let k = 1; k < rise.length; k++) {
          expect(rise[k].note).toBeGreaterThan(rise[k - 1].note)
          expect(rise[k].slide).toBe(true)
        }
        const hits = notesOf(s, name, 'ch6')
          .filter((n) => n.note === arc)
          .map((n) => n.step)
        const gaps = hits.slice(1).map((v, k) => v - hits[k])
        expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0])
      }
    }
  })

  it('el violín canta en menor por encima de la orquesta, y los chelos por debajo', () => {
    const minor = scaleById('minor').steps
    for (const s of songs) {
      const lead = s.patterns.flatMap((p) => p.notes.fm4 ?? [])
      expect(lead.length).toBeGreaterThan(20)
      // menor natural, con la sensible de la dominante armónica y la segunda napolitana
      for (const n of lead) expect([...minor, 1, 11]).toContain((((n.note - s.key) % 12) + 12) % 12)
      const mean = (ns: Note[]): number => ns.reduce((a, n) => a + n.note, 0) / ns.length
      const cellos = s.patterns.flatMap((p) => p.notes.fm1 ?? [])
      const spiccato = s.patterns.flatMap((p) => p.notes.fm2 ?? [])
      expect(mean(lead)).toBeGreaterThan(mean(spiccato))
      expect(mean(spiccato)).toBeGreaterThan(mean(cellos))
      expect(Math.max(...cellos.map((n) => n.note))).toBeLessThan(60)
    }
  })

  it('la lluvia no pisa el trueno en el canal de ruido', () => {
    for (const s of songs)
      for (const p of s.patterns) {
        const nz = [...(p.notes.noise ?? [])].sort((a, b) => a.step - b.step)
        for (let k = 1; k < nz.length; k++) expect(nz[k].step, `${s.title} ${p.name}`).toBeGreaterThanOrEqual(nz[k - 1].step + nz[k - 1].len)
      }
  })
})
