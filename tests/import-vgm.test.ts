import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { psgPeriodFromHz, ymFreqFromHz } from '../src/core/chipmath'
import { buildMidi } from '../src/export/midi'
import { renderSong } from '../src/export/render'
import { songToProjectFile } from '../src/export/share'
import { buildVgm } from '../src/export/vgm'
import { estimateGrid, stepOf } from '../src/import/grid'
import { importSong } from '../src/import'
import { songFromVgm } from '../src/import/vgm'
import { parseVgm } from '../src/import/vgmParse'
import { pitchParts } from '../src/import/ymTrack'
import { generateSong, type StyleId } from '../src/music/generator'
import { patternSteps, type Song } from '../src/music/song'

// ── un VGM hecho a mano: el YM2612 y el SN76489 con su tiempo en muestras de 44,1 kHz ──
const YM = 7_670_454
const SN = 3_579_545
class Vgm {
  body: number[] = []
  t = 0
  private wait(n: number): void {
    while (n > 0) {
      const c = Math.min(n, 65535)
      this.body.push(0x61, c & 255, c >> 8)
      n -= c
    }
  }
  at(t: number): this {
    if (t > this.t) {
      this.wait(Math.round(t) - this.t)
      this.t = Math.round(t)
    }
    return this
  }
  ym(reg: number, val: number, port = 0): this {
    this.body.push(0x52 + port, reg, val)
    return this
  }
  psg(val: number): this {
    this.body.push(0x50, val)
    return this
  }
  raw(...b: number[]): this {
    this.body.push(...b)
    return this
  }
  /** parche de un canal FM (algoritmo 4: dos pilas) con las portadoras al volumen `tl` */
  patch(ch: number, tl = 20): this {
    const port = ch < 3 ? 0 : 1
    const c = ch % 3
    const ops: [number, number, number][] = [
      [0, 41, 0x1f],
      [8, tl, 0x1f],
      [4, 12, 0x1f],
      [12, tl, 0x1f],
    ]
    for (const [off, t, ar] of ops) {
      this.ym(0x30 + off + c, (3 << 4) | (off === 12 ? 2 : 1), port)
      this.ym(0x40 + off + c, t, port)
      this.ym(0x50 + off + c, ar, port)
      this.ym(0x60 + off + c, 9, port)
      this.ym(0x70 + off + c, 3, port)
      this.ym(0x80 + off + c, 0x4a, port)
    }
    this.ym(0xb0 + c, (5 << 3) | 4, port)
    this.ym(0xb4 + c, 0xc0, port)
    return this
  }
  freq(ch: number, hz: number): this {
    const { fnum, block } = ymFreqFromHz(hz, YM)
    const port = ch < 3 ? 0 : 1
    this.ym(0xa4 + (ch % 3), (block << 3) | (fnum >> 8), port)
    this.ym(0xa0 + (ch % 3), fnum & 255, port)
    return this
  }
  key(ch: number, on: boolean): this {
    return this.ym(0x28, (on ? 0xf0 : 0) | (ch < 3 ? ch : ch + 1))
  }
  build(opts: { loopAt?: number; bank?: number[] } = {}): Uint8Array {
    const data: number[] = []
    if (opts.bank) data.push(0x67, 0x66, 0x00, ...[opts.bank.length & 255, (opts.bank.length >> 8) & 255, 0, 0], ...opts.bank)
    const stream = [...data, ...this.body, 0x66]
    const h = new Array<number>(0x100).fill(0)
    const w32 = (o: number, v: number): void => {
      for (let i = 0; i < 4; i++) h[o + i] = (v >>> (8 * i)) & 255
    }
    ;[0x56, 0x67, 0x6d, 0x20].forEach((c, i) => (h[i] = c))
    w32(0x04, 0x100 + stream.length - 4)
    w32(0x08, 0x150)
    w32(0x0c, SN)
    w32(0x18, this.t)
    w32(0x2c, YM)
    w32(0x34, 0x100 - 0x34)
    if (opts.loopAt !== undefined) {
      w32(0x1c, 1) // desplazamiento no nulo: hay bucle
      w32(0x20, this.t - opts.loopAt)
    }
    return Uint8Array.from([...h, ...stream])
  }
}

const SIXTEENTH = (bpm: number): number => (44100 * 15) / bpm

describe('lector de VGM', () => {
  it('lee las escrituras con su tiempo, el bucle y la etiqueta GD3 de lo que exporta la app', () => {
    const src = generateSong({ style: 'cosmic', seed: 3, key: 2 })
    const tl = parseVgm(buildVgm(src, { title: 'MI TEMA', author: 'YO' }))
    expect(tl.ymClock).toBe(7_670_454)
    expect(tl.snClock).toBe(3_579_545)
    expect(tl.title).toBe('MI TEMA')
    expect(tl.author).toBe('YO')
    expect(tl.ym.length).toBeGreaterThan(1000)
    expect(tl.psg.length).toBeGreaterThan(100)
    expect(tl.ym[tl.ym.length - 1].t).toBeLessThanOrEqual(tl.total)
    expect(tl.loopAt).toBeGreaterThan(0)
    // un .vgz (gzip) se lee igual
    expect(parseVgm(gzipSync(buildVgm(src))).ym.length).toBe(tl.ym.length)
    expect(() => parseVgm(Uint8Array.from([1, 2, 3, 4]))).toThrow('No es un archivo VGM')
  })

  it('el banco de PCM y los comandos 0x8n llegan como escrituras al DAC con su posición en el banco', () => {
    const bank = Array.from({ length: 40 }, (_, i) => 128 + Math.round(60 * Math.sin(i / 3)))
    const v = new Vgm().ym(0x2b, 0x80).raw(0xe0, 10, 0, 0, 0).raw(0x83, 0x83, 0x83)
    const tl = parseVgm(v.build({ bank }))
    const dac = tl.ym.filter((w) => w.reg === 0x2a)
    expect(dac.map((w) => w.val)).toEqual([bank[10], bank[11], bank[12]])
    expect(dac.map((w) => w.bank)).toEqual([10, 11, 12])
    expect(dac.map((w) => w.t)).toEqual([0, 3, 6])
  })
})

describe('medir el tempo', () => {
  const times = (bpm: number, steps: number[], phase = 0.3): number[] => steps.map((k) => phase + (k * 15) / bpm)
  const seq = (n: number, pattern: number[]): number[] => Array.from({ length: n }, (_, i) => Math.floor(i / pattern.length) * 16 + pattern[i % pattern.length])

  it('un tempo entero, uno fraccionario de drivers de frames (7 frames por paso = 128,57 BPM) y el alias de doble tiempo', () => {
    const dense = seq(600, [0, 3, 4, 6, 8, 10, 11, 14])
    const a = estimateGrid(times(100, dense))
    expect(a.bpm).toBeCloseTo(100, 1)
    expect(a.swung).toBe(false)
    const frames = estimateGrid(times(900 / 7, dense, 0.1))
    expect(frames.bpm).toBeCloseTo(900 / 7, 1)
    // solo corcheas: la rejilla de semicorcheas más lenta que las explica (120), no la de 60
    const eighths = estimateGrid(times(120, seq(500, [0, 2, 4, 6, 8, 10, 12, 14])))
    expect(eighths.bpm).toBeCloseTo(120, 1)
    expect(stepOf(a, 0.3 + (13 * 15) / 100)).toBe(Math.round((0.3 + (13 * 15) / 100 - a.origin) / a.step))
  })

  it('el swing de tresillo se mide como la rejilla de semicorcheas con swing (la rejilla de tercios de negra no es la buena)', () => {
    // corcheas con swing a 150 BPM: en cada negra, un golpe al principio y otro a 2/3
    const beat = 60 / 150
    const onsets: number[] = []
    for (let b = 0; b < 400; b++) onsets.push(0.2 + b * beat, 0.2 + b * beat + (2 / 3) * beat)
    const g = estimateGrid(onsets)
    expect(g.swung).toBe(true)
    expect(g.bpm).toBeCloseTo(150, 0)
    // los contratiempos caen en el paso 2 de cada negra
    expect(stepOf(g, 0.2 + (2 / 3) * beat) - stepOf(g, 0.2)).toBe(2)
    expect(stepOf(g, 0.2 + beat) - stepOf(g, 0.2)).toBe(4)
  })
})

describe('de los registros a las notas', () => {
  const log = (...e: [number, number][]): { t: number; midi: number }[] => e.map(([t, midi]) => ({ t, midi }))
  const F = 735

  it('un vibrato no parte la nota y un golpe de tono corto al principio no es otra nota', () => {
    const vib = pitchParts(log([0, 69], [10 * F, 69.3], [12 * F, 68.8], [14 * F, 69.2], [16 * F, 68.9]), 0, 30 * F)
    expect(vib).toHaveLength(1)
    expect(vib[0].note).toBe(69)
    // un bombo FM: arranca 20 semitonos arriba y cae en 5 frames
    const kick = pitchParts(log([0, 90], [F, 80], [2 * F, 70], [3 * F, 58], [4 * F, 47], [5 * F, 38]), 0, 20 * F)
    expect(kick.map((p) => p.note)).toEqual([38])
  })

  it('una altura que se sostiene 4 frames o más es una nota ligada; un arpegio rápido es un acorde en la pista', () => {
    const legato = pitchParts(log([0, 60], [20 * F, 64], [40 * F, 67]), 0, 60 * F)
    expect(legato.map((p) => [p.note, p.slide])).toEqual([[60, false], [64, true], [67, true]])
    expect(legato[1].t0).toBe(20 * F)
    const arp: [number, number][] = []
    for (let i = 0; i < 24; i++) arp.push([i * F, [60, 64, 67][i % 3]])
    const chord = pitchParts(log(...arp), 0, 24 * F)
    expect(chord.map((p) => p.note).sort()).toEqual([60, 64, 67])
    expect(chord.every((p) => p.t0 === 0 && p.t1 === 24 * F)).toBe(true)
  })
})

/** notas de una canción en orden de reproducción, por pista: «paso global:nota» */
function played(song: Song, ids: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let at = 0
  for (const pid of song.order) {
    const p = song.patterns.find((x) => x.id === pid)!
    for (const id of ids) for (const n of p.notes[id] ?? []) (out[id] ??= []).push(`${at + n.step}:${n.note}`)
    at += patternSteps(song, p)
  }
  return out
}
const VOICES = ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'sq1', 'sq2', 'sq3']

describe('importar VGM', () => {
  it('un VGM hecho a mano: tempo, notas con su parche y su volumen, PSG y los dos sonidos del DAC', () => {
    const T = SIXTEENTH(120)
    const bank = [...Array.from({ length: 60 }, (_, i) => 128 + Math.round(70 * Math.sin(i / 2))), ...Array.from({ length: 60 }, (_, i) => (i % 12 < 6 ? 200 : 56))]
    const ev: [number, (v: Vgm) => void][] = []
    const hz = [440, 523.25, 659.25, 523.25]
    for (let i = 0; i < 32; i++) {
      const t = i * 2 * T
      const tl = i % 2 === 0 ? 20 : 32
      ev.push([t, (v) => v.ym(0x48, tl).ym(0x4c, tl).freq(0, hz[i % 4]).key(0, true)])
      ev.push([t + 1.5 * T, (v) => v.key(0, false)])
      const p = psgPeriodFromHz(440, SN)
      ev.push([t + T, (v) => v.psg(0x80 | (p & 15)).psg(p >> 4).psg(0x92)])
      ev.push([t + 2 * T - 100, (v) => v.psg(0x9f)])
    }
    for (let k = 0; k < 4; k++) ev.push([k * 4 * T, (v) => v.raw(0xe0, (k % 2) * 60, 0, 0, 0).raw(...new Array<number>(60).fill(0x83))])
    const v = new Vgm()
    v.ym(0x2b, 0x80).patch(0, 20)
    v.t = 0
    // los comandos 0x8n gastan 3 muestras cada uno: se ordenan por tiempo y el hueco se rellena con esperas
    for (const [t, fn] of ev.sort((a, b) => a[0] - b[0])) {
      v.at(Math.max(t, v.t))
      fn(v)
      if (v.body.slice(-1)[0] === 0x83) v.t += 180
    }
    const r = songFromVgm(v.build({ bank }), 'mi vgm.vgm')
    const s = r.song
    expect(s.title).toBe('mi vgm')
    expect(s.bpm).toBe(120)
    expect(s.swingGrid).toBe(2)
    expect(s.loopStart).toBe(-1)
    const fm1 = played(s, ['fm1']).fm1
    expect(fm1).toHaveLength(32)
    expect(fm1.slice(0, 4)).toEqual(['0:69', '2:72', '4:76', '6:72'])
    // el volumen de las portadoras: TL 20 es la velocidad 15 y TL 32 (9 dB más bajo) es la 5
    const notes = s.patterns.flatMap((p) => p.notes.fm1)
    expect(notes.slice(0, 2).map((n) => n.vel)).toEqual([15, 5])
    // el parche sale de los registros: algoritmo, realimentación, operadores y panorama
    const t1 = s.tracks.find((t) => t.id === 'fm1')!
    const patch = s.fmBank[t1.inst]
    expect([patch.alg, patch.fb]).toEqual([4, 5])
    expect(patch.ops.map((o) => [o.mul, o.dt])).toEqual([[1, 3], [1, 3], [1, 3], [2, 3]])
    expect(patch.ops.map((o) => o.tl)).toEqual([41, 20, 12, 20])
    expect(t1.pan).toBe('C')
    // PSG: una nota por contratiempo, con la velocidad de su volumen
    const sq1 = s.patterns.flatMap((p) => p.notes.sq1)
    expect(sq1.slice(0, 3).map((n) => [n.step, n.note, n.vel])).toEqual([[1, 69, 13], [3, 69, 13], [5, 69, 13]])
    // DAC: dos muestras distintas en el kit y los disparos A B A B en su sitio
    expect(s.drumKit.filter((d) => d.kind === 'sample')).toHaveLength(2)
    expect(s.drumKit[0].rate).toBe(14700)
    const dr = s.patterns.flatMap((p) => p.notes.ch6).slice(0, 4)
    expect(dr.map((n) => [n.step, n.note])).toEqual([[0, 0], [4, 1], [8, 0], [12, 1]])
    expect(r.report.dropped).toBe(0)
  })

  for (const [style, seed, key] of [['cosmic', 3, 2], ['minimal', 2, 0], ['fusion', 4, 7], ['swing', 2, 0], ['house', 5, 9]] as [StyleId, number, number][]) {
    it(`ida y vuelta (${style}): lo que exporta la app se importa con el mismo tempo, bucle, swing y casi las mismas notas`, () => {
      const src = generateSong({ style, seed, key })
      const r = songFromVgm(buildVgm(src), 'x.vgm')
      expect(r.song.bpm).toBe(src.bpm)
      expect(r.song.swingGrid).toBe(src.swingGrid)
      expect(r.song.loopStart).toBe(src.loopStart)
      expect(r.song.order.length).toBe(src.order.length)
      const a = played(src, VOICES)
      const b = played(r.song, VOICES)
      let want = 0
      let same = 0
      for (const id of VOICES) {
        const sb = new Set(b[id] ?? [])
        for (const x of a[id] ?? []) {
          want++
          if (sb.has(x)) same++
        }
      }
      expect(same / want, `${style} notas recuperadas`).toBeGreaterThan(0.97)
      // cada canal FM conserva el algoritmo del parche con el que más suena
      for (const t of src.tracks.filter((x) => x.kind === 'fm' && (a[x.id]?.length ?? 0) > 0)) {
        const got = r.song.fmBank[r.song.tracks.find((x) => x.id === t.id)!.inst]
        expect(got.name, `${style} ${t.id}`).toBe(`VGM FM${t.ch + 1}`)
      }
    })
  }
})

describe('importar: el despachador y el sonido', () => {
  it('reconoce MIDI, VGM, VGZ y proyecto por su contenido y rechaza lo demás con un mensaje claro', () => {
    const src = generateSong({ style: 'cosmic', seed: 2, key: 0, bars: 4 })
    expect(importSong(buildMidi(src), 'a.mid').kind).toBe('MIDI')
    expect(importSong(buildVgm(src), 'a.vgm').kind).toBe('VGM')
    expect(importSong(gzipSync(buildVgm(src)), 'a.vgz').kind).toBe('VGM')
    const project = importSong(new TextEncoder().encode(songToProjectFile(src)), 'a.tzmd.json')
    expect(project.kind).toBe('proyecto')
    expect(project.song.patterns.length).toBe(src.patterns.length)
    expect(project.report).toBeUndefined()
    expect(() => importSong(Uint8Array.from([1, 2, 3, 4, 5]), 'a.bin')).toThrow()
    // un VGM de otro chip no deja notas: se dice claro
    const empty = new Vgm().raw(0x54, 0x20, 0x01).at(1000).build()
    expect(() => songFromVgm(empty)).toThrow('no tiene notas')
    expect(songFromVgm(buildVgm(src)).report.info?.[0]).toContain('Tempo medido')
  })

  it('el tema importado suena como el original: mismo nivel y mismo brillo sin la batería', () => {
    const src = generateSong({ style: 'cosmic', seed: 3, key: 2, bars: 4 })
    const back = songFromVgm(buildVgm(src), 'x.vgm').song
    const quiet = (s: Song): Song => ({ ...s, order: s.order.slice(1, 3), loopStart: -1, tracks: s.tracks.map((t) => ({ ...t, mute: t.id === 'ch6' || t.id === 'noise' })) })
    const level = (s: Song): { rms: number; bright: number } => {
      const a = renderSong(quiet(s), { sampleRate: 22050, tail: 0.3 })
      let e = 0
      let d = 0
      for (let i = 1; i < a.left.length; i++) {
        e += a.left[i] * a.left[i]
        d += (a.left[i] - a.left[i - 1]) ** 2
      }
      return { rms: 10 * Math.log10(e / a.left.length + 1e-12), bright: 10 * Math.log10(d / Math.max(e, 1e-12)) }
    }
    const x = level(src)
    const y = level(back)
    expect(Math.abs(x.rms - y.rms), `rms ${x.rms.toFixed(1)} vs ${y.rms.toFixed(1)}`).toBeLessThan(2.5)
    expect(Math.abs(x.bright - y.bright), `brillo ${x.bright.toFixed(1)} vs ${y.bright.toFixed(1)}`).toBeLessThan(3)
  })
})
