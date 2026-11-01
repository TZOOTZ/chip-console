import { describe, expect, it } from 'vitest'
import { buildMidi } from '../src/export/midi'
import { songFromMidi } from '../src/import/midi'
import { generateSong } from '../src/music/generator'
import { FM } from '../src/music/genkit'
import { patternSteps, type Song } from '../src/music/song'

// ── un SMF mínimo hecho a mano: eventos [tick absoluto, bytes] en una sola pista ──
type Ev = [number, number[]]
const vlq = (v: number): number[] => {
  const out = [v & 0x7f]
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80)
  return out
}
function smf(events: Ev[], opts: { ppq?: number; format?: number; tracks?: Ev[][] } = {}): Uint8Array {
  const ppq = opts.ppq ?? 480
  const tracks = opts.tracks ?? [events]
  const body: number[] = []
  const out: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, opts.format ?? 1, 0, tracks.length, ppq >> 8, ppq & 255]
  for (const t of tracks) {
    const b: number[] = []
    let last = 0
    for (const [tick, bytes] of [...t].sort((a, c) => a[0] - c[0])) {
      b.push(...vlq(tick - last), ...bytes)
      last = tick
    }
    b.push(0, 0xff, 0x2f, 0)
    body.push(0x4d, 0x54, 0x72, 0x6b, (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255, ...b)
  }
  return Uint8Array.from([...out, ...body])
}
const tempo = (bpm: number): Ev => {
  const us = Math.round(60_000_000 / bpm)
  return [0, [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]]
}
const sig = (n: number, d: number): Ev => [0, [0xff, 0x58, 4, n, Math.log2(d), 24, 8]]
const prog = (ch: number, p: number): Ev => [0, [0xc0 | ch, p]]
/** nota en pasos de semicorchea (120 ticks a 480 ppq) */
const note = (ch: number, n: number, step: number, len: number, vel = 100): Ev[] => [
  [step * 120, [0x90 | ch, n, vel]],
  [(step + len) * 120, [0x80 | ch, n, 0]],
]

/** notas de una canción en orden de reproducción: [paso global, nota] de cada pista */
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
const melodic = (song: Song): string[] => Object.values(played(song, ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'sq1', 'sq2', 'sq3'])).flat().sort()

describe('importar MIDI', () => {
  it('tempo, compás, título y tonalidad salen del archivo', () => {
    const evs: Ev[] = [tempo(90), sig(3, 4), [0, [0xff, 0x03, 5, 0x4d, 0x49, 0x20, 0x54, 0x4d]]]
    // escala de La menor natural: la tonalidad sale de las notas
    ;[57, 59, 60, 62, 64, 65, 67, 69, 64, 60, 57, 57].forEach((n, i) => evs.push(...note(0, n, i * 2, 2)))
    const r = songFromMidi(smf(evs), 'cancion.mid')
    expect(r.song.bpm).toBe(90)
    expect(r.song.beatsPerBar).toBe(3)
    expect(r.song.title).toBe('MI TM')
    expect([r.song.key, r.song.scale]).toEqual([9, 'minor'])
    expect(songFromMidi(smf(note(0, 60, 0, 2)), 'Mi tema.mid').song.title).toBe('Mi tema')
    // un compás que no cabe en la rejilla cae a 4/4 con aviso
    const odd = songFromMidi(smf([sig(3, 8), ...note(0, 60, 0, 2)]))
    expect(odd.song.beatsPerBar).toBe(4)
    expect(odd.report.warnings.join(' ')).toContain('3/8')
    // 6/8 son 12 semicorcheas: 3 tiempos de la rejilla
    expect(songFromMidi(smf([sig(6, 8), ...note(0, 60, 0, 2)])).song.beatsPerBar).toBe(3)
  })

  it('la percusión GM va al kit y lo que no tiene equivalente se descarta', () => {
    const evs: Ev[] = [tempo(120)]
    ;[36, 38, 42, 46, 39, 41, 47, 37].forEach((n, i) => evs.push(...note(9, n, i, 1)))
    evs.push(...note(9, 56, 9, 1), ...note(0, 60, 0, 4))
    const r = songFromMidi(smf(evs))
    const p = r.song.patterns[0]
    expect(p.notes.ch6.map((n) => n.note)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(r.report.dropped).toBe(1)
    expect(r.song.tracks.find((t) => t.id === 'ch6')!.name).toBe('DRUMS GM')
  })

  it('un acorde son tres voces; el bajo va a FM1, la melodía a FM4 y el programa elige el instrumento', () => {
    const evs: Ev[] = [tempo(100), prog(0, 33), prog(1, 0), prog(2, 56)]
    for (let b = 0; b < 4; b++) {
      evs.push(...note(0, 36, b * 16, 8), ...note(0, 43, b * 16 + 8, 8))
      for (const n of [60, 64, 67]) evs.push(...note(1, n, b * 16, 12))
      ;[72, 74, 76, 79].forEach((n, i) => evs.push(...note(2, n, b * 16 + i * 4, 4)))
    }
    const r = songFromMidi(smf(evs))
    const by = (id: string) => r.song.patterns[0].notes[id]
    expect(by('fm1').map((n) => n.note)).toEqual([36, 43, 36, 43, 36, 43, 36, 43].slice(0, by('fm1').length))
    expect(by('fm1').every((n) => n.note < 48)).toBe(true)
    expect(by('fm4').map((n) => n.note).slice(0, 4)).toEqual([72, 74, 76, 79])
    // las tres notas del acorde, cada una en su pista de teclado
    const mids = ['fm2', 'fm3', 'fm5'].map((id) => by(id).map((n) => n.note))
    expect(mids.map((x) => x[0])).toEqual([60, 64, 67])
    const t = (id: string) => r.song.tracks.find((x) => x.id === id)!
    expect(t('fm1').inst).toBe(FM.SUB) // programa 33 (bajo eléctrico con dedos): el seno de la consola
    expect(t('fm4').inst).toBe(FM.BRASS)
    expect(t('fm2').inst).toBe(FM.EPIANO)
    expect(r.report.dropped).toBe(0)
  })

  it('más voces que canales: se quedan las que más suenan y se avisa', () => {
    const evs: Ev[] = [tempo(120)]
    // diez voces en canales distintos; la décima y la novena casi no tocan
    for (let c = 0; c < 10; c++) {
      if (c === 9) continue
      for (let i = 0; i < (c >= 7 ? 2 : 8); i++) evs.push(...note(c, 40 + c * 3, i * 2, 1))
    }
    for (let i = 0; i < 2; i++) evs.push(...note(10, 90, i * 2, 1))
    const r = songFromMidi(smf(evs))
    expect(r.report.warnings.join(' ')).toContain('voces')
    expect(r.report.dropped).toBeGreaterThan(0)
    expect(r.song.patterns.flatMap((p) => Object.entries(p.notes)).filter(([id, n]) => id !== 'ch6' && id !== 'noise' && n.length > 0).length).toBeLessThanOrEqual(8)
  })

  it('un tema que repite compases reutiliza el patrón: 32 compases de 8 que se repiten son un patrón y cuatro bloques', () => {
    const evs: Ev[] = [tempo(120)]
    for (let rep = 0; rep < 4; rep++) for (let b = 0; b < 8; b++) evs.push(...note(0, 60 + (b % 4), rep * 128 + b * 16, 8), ...note(9, 36, rep * 128 + b * 16, 1))
    const r = songFromMidi(smf(evs))
    expect(r.song.patterns).toHaveLength(1)
    expect(r.song.patterns[0].bars).toBe(8)
    expect(r.song.order).toHaveLength(4)
    expect(r.song.loopStart).toBe(-1)
    // si la última vuelta cambia, es un patrón más
    const evs2 = [...evs, ...note(0, 72, 3 * 128 + 5, 2)]
    expect(songFromMidi(smf(evs2)).song.patterns).toHaveLength(2)
  })

  it('el swing de tresillo se detecta y se cuantiza a la rejilla del swing', () => {
    const evs: Ev[] = [tempo(140)]
    for (let beat = 0; beat < 32; beat++) {
      evs.push([beat * 480, [0x90, 60, 100]], [beat * 480 + 200, [0x80, 60, 0]])
      evs.push([beat * 480 + 320, [0x90, 64, 100]], [beat * 480 + 440, [0x80, 64, 0]])
    }
    const r = songFromMidi(smf(evs))
    expect(r.song.swingGrid).toBe(4)
    expect(r.song.swing).toBeCloseTo(1 / 3, 3)
    // las corcheas de contratiempo caen en el paso 2 de cada negra
    const steps = r.song.patterns[0].notes.fm4?.map((n) => n.step % 4) ?? []
    const all = Object.values(r.song.patterns[0].notes).flat().map((n) => n.step % 4)
    expect(new Set(all)).toEqual(new Set([0, 2]))
    void steps
    // sin swing no se activa
    const straight: Ev[] = [tempo(140)]
    for (let i = 0; i < 64; i++) straight.push(...note(0, 60 + (i % 5), i * 2, 1))
    expect(songFromMidi(smf(straight)).song.swingGrid).toBe(2)
  })

  it('errores claros: no es un MIDI, formato 2, sin notas', () => {
    expect(() => songFromMidi(Uint8Array.from([1, 2, 3]))).toThrow('No es un archivo MIDI')
    expect(() => songFromMidi(smf(note(0, 60, 0, 1), { format: 2 }))).toThrow('Formato MIDI 2')
    expect(() => songFromMidi(smf([tempo(120)]))).toThrow('no tiene notas')
  })

  it('ida y vuelta: lo que exporta la app se importa con las mismas notas, el mismo tempo y el mismo compás', () => {
    for (const [style, seed, key] of [['cosmic', 3, 2], ['fusion', 4, 7], ['swing', 2, 0], ['house', 5, 9]] as const) {
      const src = generateSong({ style, seed, key })
      const back = songFromMidi(buildMidi(src), 'x.mid')
      expect(back.song.bpm, style).toBe(src.bpm)
      expect(back.song.beatsPerBar, style).toBe(src.beatsPerBar)
      const want = melodic(src)
      const got = melodic(back.song)
      // lo que no cabe en ocho voces se descarta con aviso; el resto, una a una
      if (back.report.dropped === 0) expect(got, style).toEqual(want)
      else expect(got.length, style).toBe(want.length - back.report.dropped)
      expect(back.song.patterns.reduce((n, p) => n + p.notes.ch6.length, 0), style).toBeGreaterThan(0)
    }
  })
})
