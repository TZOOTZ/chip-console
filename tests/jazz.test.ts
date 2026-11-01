import { describe, expect, it } from 'vitest'
import { renderSong } from '../src/export/render'
import { songFromHash, songToHash } from '../src/export/share'
import { STYLES, generateSong, generateTrackNotes, type FillKind, type StyleId } from '../src/music/generator'
import { FM } from '../src/music/genkit'
import { JAZZ_BPM, JAZZ_KIT, chordScalePcs, chordTonePcs, jazzProgressions, leadRange, voicingPcs, type JazzChord, type JazzStyle } from '../src/music/jazz'
import { FM_PRESETS, createEmptySong } from '../src/music/presets'
import { emptyPattern, patternSteps, type Song } from '../src/music/song'

const FEELS: JazzStyle[] = ['fusion', 'swing']
const mod12 = (n: number): number => ((n % 12) + 12) % 12
const pat = (song: Song, name: string) => song.patterns.find((p) => p.name === name)!

/** acordes de un tema: cada segmento con su paso de inicio absoluto */
const segments = (prog: JazzChord[][], spb: number) => prog.flatMap((cs, b) => cs.map((c) => ({ step: b * spb + c.at, end: b * spb + c.at + c.len, c })))

/** pasos de semicorchea por unidad de composición: el swing se escribe en corcheas (2), la fusión en semicorcheas (1) */
const unitOf = (feel: JazzStyle): number => (feel === 'swing' ? 2 : 1)

/** la progresión (de las del estilo) cuyas fundamentales coinciden con el bajo del patrón (pasos en unidades de composición) */
function progressionOf(song: Song, feel: JazzStyle, name: string): JazzChord[][] | null {
  const p = pat(song, name)
  const unit = unitOf(feel)
  const spb = 16 / unit
  for (const prog of jazzProgressions(feel, p.bars, spb)) {
    const ok = segments(prog, spb).every(({ step, c }) => {
      const n = (p.notes.fm1 ?? []).find((x) => x.step === step * unit)
      return n !== undefined && mod12(n.note) === mod12(song.key + c.root)
    })
    if (ok) return prog
  }
  return null
}

describe('JAZZ FUSION y JAZZ SWING', () => {
  it('están en la lista de estilos, con su tempo, y el banco FM trae los cuatro sonidos de jazz al final', () => {
    for (const feel of FEELS) expect(STYLES.find((s) => s.id === feel)!.bpm).toEqual(JAZZ_BPM[feel])
    expect(FM_PRESETS.slice(FM.SAX).map((p) => p.name)).toEqual(['SAX', 'JAZZ GUITAR', 'WALK BASS', 'VIBES'])
    expect([FM.SAX, FM.JAZZ_GUITAR, FM.WALK_BASS, FM.VIBES]).toEqual([25, 26, 27, 28])
    expect(createEmptySong().fmBank.length).toBe(FM_PRESETS.length)
  })

  for (const feel of FEELS) {
    it(`${feel}: estructura, tempo automático y fijado, y determinismo por semilla`, () => {
      const info = STYLES.find((s) => s.id === feel)!
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const song = generateSong({ style: feel, seed, key: seed % 12 })
        expect(song.bpm).toBeGreaterThanOrEqual(info.bpm[0])
        expect(song.bpm).toBeLessThanOrEqual(info.bpm[1])
        expect(song.patterns.map((p) => p.name)).toEqual(['INTRO', 'HEAD', 'SOLO', 'SOLO 2', 'BRIDGE', 'OUT HEAD', 'TAG'])
        expect(song.order.map((id) => song.patterns.find((p) => p.id === id)!.name)).toEqual(['INTRO', 'HEAD', 'HEAD', 'SOLO', 'SOLO 2', 'BRIDGE', 'OUT HEAD', 'OUT HEAD', 'TAG'])
        expect(song.loopStart).toBe(1)
        expect(song.beatsPerBar).toBe(4)
        expect(song.swing).toBe(feel === 'swing' ? 0.33 : 0.06)
        expect(song.swingGrid).toBe(feel === 'swing' ? 4 : 2)
        expect(song.lfo).toBe(2)
        expect(song.drumKit).toEqual(JAZZ_KIT)
        expect(song.title).toBe(`${info.name} ${String(seed).padStart(4, '0')}`)
      }
      expect(generateSong({ style: feel, seed: 4, key: 7, bpm: 91 }).bpm).toBe(91)
      expect(JSON.stringify(generateSong({ style: feel, seed: 9, key: 2 }))).toBe(JSON.stringify(generateSong({ style: feel, seed: 9, key: 2 })))
      const variants = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(pat(generateSong({ style: feel, seed, key: 0 }), 'SOLO').notes.fm4)))
      expect(variants.size).toBeGreaterThanOrEqual(5)
    })

    it(`${feel}: el bajo sigue los acordes, el teclado conduce las voces y la melodía respeta la armonía`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        for (const key of [0, 5, 9]) {
          const song = generateSong({ style: feel, seed, key })
          const unit = unitOf(feel)
          const spb = 16 / unit
          const beat = feel === 'swing' ? 2 : 4
          const [lo, hi] = leadRange(feel)
          for (const name of ['HEAD', 'SOLO', 'SOLO 2', 'OUT HEAD']) {
            const prog = progressionOf(song, feel, name)
            const tag = `${feel} #${seed} ${key} ${name}`
            expect(prog, tag).not.toBeNull()
            const segs = segments(prog!, spb)
            const at = (step: number) => segs.find((s) => step / unit >= s.step && step / unit < s.end)!.c
            const p = pat(song, name)
            // teclado: cada voz es tercera, séptima o extensión del acorde que suena
            const comp = ['fm2', 'fm3', 'fm5'].map((t) => p.notes[t] ?? [])
            for (const notes of comp) for (const n of notes) expect(voicingPcs(song.key, at(n.step)), `${tag} teclado ${n.note}@${n.step}`).toContain(mod12(n.note))
            // las tres voces suenan a la vez: la grave en FM2, la aguda en FM5
            for (const s of new Set(comp.flat().map((n) => n.step))) {
              const v = comp.map((notes) => notes.find((n) => n.step === s)?.note)
              expect(v.every((x) => x !== undefined), `${tag} voces @${s}`).toBe(true)
              expect(v[0]! < v[1]! && v[1]! < v[2]!, `${tag} orden de voces @${s}`).toBe(true)
              expect(v[0]!).toBeGreaterThanOrEqual(52)
              expect(v[2]!).toBeLessThanOrEqual(76)
            }
            // conducción de voces: ninguna voz salta más de una cuarta aumentada entre un acorde y el siguiente
            const hits = [...new Set(comp.flat().map((n) => n.step))].sort((x, y) => x - y)
            const voiced = hits.map((s) => comp.map((notes) => notes.find((n) => n.step === s)!.note))
            voiced.forEach((v, k) => {
              if (k > 0) v.forEach((n, j) => expect(Math.abs(n - voiced[k - 1][j]), `${tag} voz ${j} @${hits[k]}`).toBeLessThanOrEqual(6))
            })
            // melodía: en el registro, apoyos en notas del acorde y el resto en su escala o a un semitono de la nota siguiente
            const lead = p.notes.fm4 ?? []
            lead.forEach((n, i) => {
              expect(n.note, `${tag} registro`).toBeGreaterThanOrEqual(lo - 1)
              expect(n.note, `${tag} registro`).toBeLessThanOrEqual(hi + 1)
              const c = at(n.step)
              const nxt = lead[i + 1]
              const approach = nxt !== undefined && Math.abs(nxt.note - n.note) === 1
              if ((n.step / unit) % beat === 0 || n.len / unit >= 2) expect(chordTonePcs(song.key, c), `${tag} apoyo ${n.note}@${n.step}`).toContain(mod12(n.note))
              else expect(chordScalePcs(song.key, c).includes(mod12(n.note)) || approach, `${tag} paso ${n.note}@${n.step}`).toBe(true)
            })
          }
        }
      }
    })
  }

  it('swing: bajo andante, una negra por pulso, en su registro y sin saltos grandes ni notas repetidas', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const song = generateSong({ style: 'swing', seed, key: seed * 2 })
      for (const name of ['HEAD', 'SOLO', 'BRIDGE']) {
        const bass = pat(song, name).notes.fm1
        expect(bass.length, name).toBeGreaterThanOrEqual(pat(song, name).bars * 4)
        bass.forEach((n, i) => {
          expect(n.step % 4, `${name} paso`).toBe(0)
          expect(n.len).toBe(4)
          expect(n.note).toBeGreaterThanOrEqual(30)
          expect(n.note).toBeLessThanOrEqual(53)
          if (i > 0) {
            expect(Math.abs(n.note - bass[i - 1].note), `${name} salto ${bass[i - 1].note}→${n.note}`).toBeLessThanOrEqual(12)
            expect(n.note, `${name} repetida`).not.toBe(bass[i - 1].note)
          }
        })
      }
    }
  })

  it('fusion: bajo slap en su registro', () => {
    for (const seed of [1, 2, 3, 4]) {
      for (const p of generateSong({ style: 'fusion', seed, key: seed }).patterns) {
        for (const n of p.notes.fm1) {
          expect(n.note).toBeGreaterThanOrEqual(30)
          expect(n.note).toBeLessThanOrEqual(53)
        }
      }
    }
  })

  it('batería: solo los tres niveles de golpe 15 · 9 · 5, dentro del kit, y el swing lleva el ride en las negras', () => {
    for (const feel of FEELS) {
      const song = generateSong({ style: feel, seed: 5, key: 0 })
      for (const p of song.patterns) {
        for (const n of p.notes.ch6) {
          expect([15, 9, 5], `${feel} ${p.name}`).toContain(n.vel)
          expect(n.note).toBeLessThan(JAZZ_KIT.length)
        }
      }
    }
    const head = pat(generateSong({ style: 'swing', seed: 5, key: 0 }), 'HEAD')
    for (let b = 0; b < head.bars; b++) for (const s of [0, 4, 8, 12]) expect(head.notes.ch6.some((n) => n.step === b * 16 + s && n.note === 3), `ride ${b}:${s}`).toBe(true)
  })

  it('el enlace compartido reconstruye un tema de jazz con sus sonidos y su kit', () => {
    for (const feel of FEELS) {
      const song = generateSong({ style: feel, seed: 3, key: 4 })
      const back = songFromHash(songToHash(song))
      expect(back.patterns.map((p) => p.notes)).toEqual(song.patterns.map((p) => p.notes))
      expect(back.tracks.map((t) => [t.name, t.inst])).toEqual(song.tracks.map((t) => [t.name, t.inst]))
      expect(back.drumKit).toEqual(song.drumKit)
      expect(back.beatsPerBar).toBe(song.beatsPerBar)
      expect(back.swing).toBe(song.swing)
    }
  })

  for (const feel of FEELS) {
    it(`${feel}: rellenar una pista con el dado da notas válidas y solo pone batería en la batería`, () => {
      const song = generateSong({ style: feel, seed: 3, key: 9 })
      const p = emptyPattern(song, 4, 'X')
      const max = patternSteps(song, p)
      const cases: [FillKind, string][] = [['bass', 'fm1'], ['chords', 'fm2'], ['chords', 'fm5'], ['arp', 'sq1'], ['arp', 'fm3'], ['lead', 'fm4'], ['lead', 'sq1'], ['drums', 'ch6'], ['drums', 'noise'], ['perc', 'ch6'], ['perc', 'noise']]
      for (const [kind, track] of cases) {
        for (const seed of [1, 2, 3]) {
          const notes = generateTrackNotes(song, p, track, kind, seed, feel as StyleId)
          const tr = song.tracks.find((t) => t.id === track)!
          const tag = `${feel} ${kind} ${track} #${seed}`
          expect(notes.length, tag).toBeGreaterThan(0)
          for (const n of notes) {
            expect(n.step, tag).toBeGreaterThanOrEqual(0)
            expect(n.step + n.len, tag).toBeLessThanOrEqual(max)
            expect(n.vel).toBeGreaterThanOrEqual(1)
            expect(n.vel).toBeLessThanOrEqual(15)
            if (tr.kind === 'fm' || tr.kind === 'psg') expect(n.note).toBeGreaterThanOrEqual(24)
            else expect(n.note).toBeLessThan(tr.kind === 'dac' ? song.drumKit.length : song.noiseKit.length)
          }
          expect(notes.map((n) => n.step), tag).toEqual([...notes.map((n) => n.step)].sort((a, b) => a - b))
        }
      }
      // una pista que no es de batería no recibe golpes
      expect(generateTrackNotes(song, p, 'fm1', 'drums', 1, feel as StyleId)).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
describe('los cuatro parches de jazz', () => {
  const SR = 22050
  function nota(inst: number, midi: number, steps: number): Float32Array {
    const s = createEmptySong()
    s.bpm = 120
    s.patterns = []
    s.order = []
    const p = emptyPattern(s, 2, 'A')
    s.tracks[0].inst = inst
    s.tracks[0].vol = 100
    p.notes.fm1 = [{ step: 0, len: steps, note: midi, vel: 12 }]
    s.patterns.push(p)
    s.order.push(p.id)
    s.loopStart = -1
    return renderSong(s, { sampleRate: SR, tail: 0.6 }).left
  }
  const db = (x: Float32Array, t0: number, t1: number): number => {
    let e = 0
    const a = Math.floor(t0 * SR)
    const b = Math.floor(t1 * SR)
    for (let i = a; i < b; i++) e += x[i] * x[i]
    return 20 * Math.log10(Math.sqrt(e / (b - a)) + 1e-9)
  }
  const pk = (x: Float32Array): number => 20 * Math.log10(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0))
  /** nivel de los seis primeros armónicos (dB respecto a la fundamental) */
  function harmonics(x: Float32Array, f0: number): number[] {
    const from = Math.floor(0.12 * SR)
    const n = 4096
    const mag = (f: number): number => {
      let re = 0
      let im = 0
      for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
        const v = x[from + i] * w
        re += v * Math.cos((2 * Math.PI * f * (from + i)) / SR)
        im -= v * Math.sin((2 * Math.PI * f * (from + i)) / SR)
      }
      return Math.sqrt(re * re + im * im)
    }
    const h = [1, 2, 3, 4, 5, 6].map((k) => mag(f0 * k))
    return h.map((v) => 20 * Math.log10(v / h[0] + 1e-9))
  }

  it('suenan a un nivel como el de los demás parches de teclas y bajos (pico entre -24 y -9 dBFS)', () => {
    for (const [inst, midi] of [[FM.SAX, 60], [FM.JAZZ_GUITAR, 60], [FM.WALK_BASS, 40], [FM.VIBES, 72]] as const) {
      const p = pk(nota(inst, midi, 8))
      expect(p, FM_PRESETS[inst].name).toBeGreaterThan(-24)
      expect(p, FM_PRESETS[inst].name).toBeLessThan(-9)
    }
  })

  it('el contrabajo y la guitarra mandan en la fundamental; el vibráfono suena largo y la guitarra se apaga', () => {
    expect(Math.max(...harmonics(nota(FM.WALK_BASS, 40, 8), 82.41).slice(1))).toBeLessThan(-8)
    const gtr = nota(FM.JAZZ_GUITAR, 60, 8)
    expect(Math.max(...harmonics(gtr, 261.63).slice(1))).toBeLessThan(-8)
    expect(db(gtr, 0.5, 0.6)).toBeLessThan(db(gtr, 0.02, 0.08) - 6)
    const vib = nota(FM.VIBES, 72, 8)
    expect(db(vib, 0.9, 1.0)).toBeGreaterThan(db(vib, 0.02, 0.08) - 8)
  })

  it('el saxo es sostenido y de timbre rico: armónicos 2 a 4 por encima de -25 dB y sin decaer más de 10 dB en un segundo', () => {
    const x = nota(FM.SAX, 60, 8)
    expect(harmonics(x, 261.63).slice(1, 4).every((v) => v > -25)).toBe(true)
    expect(db(x, 0.9, 1.0)).toBeGreaterThan(db(x, 0.1, 0.2) - 10)
  })
})
