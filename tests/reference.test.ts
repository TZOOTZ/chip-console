// ── Contraste con un reproductor VGM independiente (opcional) ────────────────
//
// Exporta VGM de prueba, los decodifica con libgme (va dentro de ffmpeg) y
// compara con el render propio: nivel, bandas, grano del DAC, balance PSG/FM y
// aliasing. No corre con `npm test`: necesita ffmpeg con libgme en el PATH.
//
//   npm run test:ref
//
// libgme no es una consola: su núcleo FM se comporta como el YM2612 discreto,
// pero el nivel del PSG y del DAC y su recorte de agudos son decisiones de su
// autor. Por eso aquí se comprueba "cerca de la referencia", no igualdad.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SoundModel } from '../src/core/mixer'
import { Synth } from '../src/engine/synth'
import { buildVgm } from '../src/export/vgm'
import { generateSong } from '../src/music/generator'
import { FM_PRESETS, createEmptySong } from '../src/music/presets'
import type { FmOp, Song } from '../src/music/song'
import { magnitudeSpectrum } from './helpers'

const ENABLED = process.env.TZ_REF === '1' || (import.meta as { env?: { MODE?: string } }).env?.MODE === 'ref'
const SR = 44100
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12))
const f1 = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1)
const off = (): FmOp => ({ mul: 1, dt: 0, tl: 127, rs: 0, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 15, am: 0 })

function one(track: string, note: number, len = 8, vel = 15): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 1
  s.patterns[0].notes[track] = [{ step: 0, len, note, vel }]
  s.loopStart = -1
  for (const t of s.tracks) {
    t.vol = 100
    t.pan = 'C'
    t.gate = 1
  }
  return s
}

/** render propio (mono) con el modelo pedido; `lowpass` permite quitar el filtro de la Model 1 */
function own(song: Song, model: SoundModel, lowpass = true): Float32Array {
  const synth = new Synth(SR, song, model)
  synth.con.lowpass = lowpass && model === 'md1'
  synth.stopAtEnd = true
  synth.play(0, 0)
  const n = SR * 3
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  synth.render(l, r, n)
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) m[i] = (l[i] + r[i]) / 2
  return m
}

let dir = ''
/** el mismo tema decodificado por libgme (mono) */
function gme(name: string, song: Song): Float32Array {
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'tzref-'))
  const vgm = join(dir, `${name}.vgm`)
  const raw = join(dir, `${name}.f32`)
  writeFileSync(vgm, buildVgm(song, { tail: 1 }))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', vgm, '-ac', '2', '-ar', String(SR), '-f', 'f32le', raw])
  const buf = readFileSync(raw)
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const m = new Float32Array(f.length >> 1)
  for (let i = 0; i < m.length; i++) m[i] = (f[i * 2] + f[i * 2 + 1]) / 2
  return m
}

const rms = (x: ArrayLike<number>, a = 0, b = x.length): number => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}
const onset = (x: Float32Array): number => {
  let pk = 0
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]))
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > pk * 0.05) return i
  return 0
}
/** nivel RMS (dB) de los primeros 0,9 s de la nota */
const level = (x: Float32Array): number => {
  const o = onset(x)
  return db(rms(x, o, Math.min(x.length, o + Math.round(SR * 0.9))))
}
/** energía por bandas de octava (dB), 20 Hz – 2,5 kHz */
function bands(x: Float32Array): number[] {
  const size = 1 << 16
  const o = onset(x)
  const mag = magnitudeSpectrum(x.subarray(o, o + SR), size)
  const edges = [20, 80, 160, 320, 640, 1280, 2560]
  const out: number[] = []
  for (let k = 0; k + 1 < edges.length; k++) {
    let e = 0
    for (let i = Math.ceil((edges[k] * size) / SR); i < (edges[k + 1] * size) / SR; i++) e += mag[i] * mag[i]
    out.push(10 * Math.log10(e + 1e-20))
  }
  return out
}
/** todo lo que no es la fundamental, en dB respecto a ella */
function distortion(x: Float32Array, hz: number): number {
  const size = 1 << 15
  const o = onset(x) + 2000
  const mag = magnitudeSpectrum(x.subarray(o, o + size), size)
  const k0 = Math.round((hz * size) / SR)
  let fund = 0
  let rest = 0
  for (let i = 4; i < mag.length; i++) {
    const e = mag[i] * mag[i]
    if (Math.abs(i - k0) <= 6) fund += e
    else rest += e
  }
  return 10 * Math.log10(rest / fund + 1e-20)
}
const sine = (tl: number): Song => {
  const s = one('fm1', 69)
  s.fmBank[0] = { name: 'SINE', alg: 7, fb: 0, ops: [{ mul: 1, dt: 0, tl, rs: 0, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 15, am: 0 }, off(), off(), off()], ams: 0, pms: 0 }
  s.tracks[0].inst = 0
  return s
}
const square = (note: number): Song => {
  const s = one('sq1', note)
  s.psgBank[0] = { name: 'SQ', vol: 15, a: 0, d: 0, s: 0, r: 0, detune: 0 }
  s.tracks.find((t) => t.id === 'sq1')!.inst = 0
  return s
}

describe.skipIf(!ENABLED)('contraste con libgme (ffmpeg)', () => {
  it('FM: los parches de fábrica suenan igual que en la referencia', () => {
    const rows: string[] = []
    let worst = 0
    FM_PRESETS.forEach((p, i) => {
      const s = one('fm1', 48)
      s.tracks[0].inst = i
      const a = own(s, 'clean')
      const b = gme(`fm${i}`, s)
      const g = level(b) - level(a)
      const ba = bands(a)
      const bb = bands(b).map((v) => v - g)
      const top = Math.max(...ba)
      // solo las bandas con señal de verdad: por debajo de −40 dB manda el grano del DAC
      const diff = ba.map((v, k) => (v < top - 40 ? 0 : Math.abs(bb[k] - v)))
      worst = Math.max(worst, ...diff)
      rows.push(`${p.name.padEnd(12)} nivel ${f1(g)} dB · mayor diferencia por banda ${Math.max(...diff).toFixed(2)} dB`)
      expect(Math.abs(g), p.name).toBeLessThan(1.5)
      expect(Math.max(...diff), p.name).toBeLessThan(2)
    })
    console.log('\nFM frente a libgme\n' + rows.join('\n') + `\npeor banda: ${worst.toFixed(2)} dB`)
  }, 240000)

  it('DAC de 9 bits: un seno muy bajo se cuantiza igual que en la referencia', () => {
    // libgme cuantiza a 9 bits pero no modela el escalón del cruce por cero (se comporta como un
    // YM3438): se compara con nuestro DAC discreto sin ese escalón, y sin la continua.
    const s = sine(72)
    const ac = (x: Float32Array): number => {
      const o = onset(x) + 4000
      const n = SR / 2
      let mean = 0
      for (let i = o; i < o + n; i++) mean += x[i]
      mean /= n
      let e = 0
      for (let i = o; i < o + n; i++) e += (x[i] - mean) ** 2
      return db(Math.sqrt(e / n))
    }
    const ref = gme('quiet', s)
    const synth = new Synth(SR, s, 'md1')
    synth.con.lowpass = false
    synth.con.ym.ladder = false
    synth.stopAtEnd = true
    synth.play(0, 0)
    const l = new Float32Array(SR * 3)
    const r = new Float32Array(SR * 3)
    synth.render(l, r, l.length)
    const loud = sine(0)
    const refFull = level(gme('full', loud))
    const ownFull = level(own(loud, 'clean'))
    console.log(`\nseno a -54 dB respecto al seno a tope: referencia ${(ac(ref) - refFull).toFixed(1)} dB, distorsion ${distortion(ref, 440).toFixed(1)} dB / nuestro DAC de 9 bits ${(ac(l) - ownFull).toFixed(1)} dB, ${distortion(l, 440).toFixed(1)} dB`)
    expect(Math.abs(ac(l) - ownFull - (ac(ref) - refFull))).toBeLessThan(1.5)
    expect(Math.abs(distortion(l, 440) - distortion(ref, 440))).toBeLessThan(3)
  }, 120000)

  it('PSG: su nivel frente al FM queda cerca del de la referencia', () => {
    const fmRef = sine(0)
    const refOwn = level(own(fmRef, 'clean'))
    const refGme = level(gme('ref', fmRef))
    const rows: string[] = []
    for (const note of [69, 95]) {
      const s = square(note)
      const a = level(own(s, 'clean')) - refOwn
      const b = level(gme(`sq${note}`, s)) - refGme
      rows.push(`cuadrada ${note}: propio ${f1(a)} dB respecto al seno FM · referencia ${f1(b)} dB · diferencia ${f1(a - b)}`)
      expect(Math.abs(a - b)).toBeLessThan(2)
    }
    console.log('\nPSG frente al FM\n' + rows.join('\n'))
  }, 120000)

  it('la mezcla completa conserva el balance por familias', () => {
    const fam = (keep: string[]): Song => {
      const s = generateSong({ style: 'cosmic', seed: 21, key: 9 })
      s.order = [s.patterns.find((p) => p.name === 'FINAL')!.id]
      s.loopStart = -1
      for (const t of s.tracks) t.mute = !keep.includes(t.id)
      return s
    }
    const whole = (x: Float32Array): number => db(rms(x, 0, Math.min(x.length, SR * 3)))
    const fm = fam(['fm1', 'fm2', 'fm3', 'fm4', 'fm5'])
    const psg = fam(['sq1', 'sq2', 'sq3', 'noise'])
    const a = whole(own(psg, 'clean')) - whole(own(fm, 'clean'))
    const b = whole(gme('famPsg', psg)) - whole(gme('famFm', fm))
    console.log(`\nfamilia PSG respecto a la FM en el FINAL: propio ${f1(a)} dB · referencia ${f1(b)} dB`)
    expect(Math.abs(a - b)).toBeLessThan(3)
  }, 120000)
})

describe('PSG sin aliasing', () => {
  it('una cuadrada aguda (Si6) deja muy poca energía fuera de sus armónicos', () => {
    for (const model of ['clean', 'md1'] as const) {
      const x = own(square(95), model)
      const size = 1 << 16
      const o = onset(x) + 2000
      const mag = magnitudeSpectrum(x.subarray(o, o + 32768), size)
      const f0 = 3579545 / (32 * 57)
      let harm = 0
      let rest = 0
      for (let i = 8; i < mag.length; i++) {
        const hz = (i * SR) / size
        const k = Math.round(hz / f0)
        const e = mag[i] * mag[i]
        if (k >= 1 && k % 2 === 1 && Math.abs(hz - k * f0) < 30) harm += e
        else rest += e
      }
      const ratio = 10 * Math.log10(rest / harm)
      console.log(`aliasing del PSG (${model}): ${ratio.toFixed(1)} dB`)
      expect(ratio).toBeLessThan(-45)
    }
  })
})
