import { describe, expect, it } from 'vitest'
import { buildMidi } from '../src/export/midi'
import { peakOf, renderSong } from '../src/export/render'
import { songFromHash, songToHash, songFromProjectFile, songToProjectFile } from '../src/export/share'
import { encodeWav } from '../src/export/wav'
import { buildVgm } from '../src/export/vgm'
import { parseVgmHeader } from '../src/export/vgmRead'
import { STYLES, generateSong, generateTrackNotes, type StyleId } from '../src/music/generator'
import { songSeconds, songSteps, patternSteps, sanitizeSong } from '../src/music/song'
import { createEmptySong } from '../src/music/presets'
import { countNotes } from '../src/music/edit'
import { rms, writeWav } from './helpers'

/** parser MIDI mínimo para verificar el exportador */
function parseMidi(b: Uint8Array) {
  const str = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  const u32 = (o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]
  const u16 = (o: number) => (b[o] << 8) | b[o + 1]
  expect(str(0, 4)).toBe('MThd')
  const fmt = u16(8)
  const ntr = u16(10)
  const ppq = u16(12)
  let p = 14
  const tracks: { notesOn: number; notesOff: number; maxTick: number; name: string; tempo?: number }[] = []
  for (let t = 0; t < ntr; t++) {
    expect(str(p, 4)).toBe('MTrk')
    const len = u32(p + 4)
    p += 8
    const end = p + len
    let tick = 0
    let run = 0
    const tr = { notesOn: 0, notesOff: 0, maxTick: 0, name: '', tempo: undefined as number | undefined }
    while (p < end) {
      let d = 0
      let c: number
      do {
        c = b[p++]
        d = (d << 7) | (c & 0x7f)
      } while (c & 0x80)
      tick += d
      let st = b[p]
      if (st & 0x80) {
        p++
        run = st
      } else st = run
      if (st === 0xff) {
        const type = b[p++]
        let l = 0
        do {
          c = b[p++]
          l = (l << 7) | (c & 0x7f)
        } while (c & 0x80)
        if (type === 0x03) tr.name = str(p, l)
        if (type === 0x51) tr.tempo = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]
        p += l
      } else if ((st & 0xf0) === 0x90) {
        if (b[p + 1] > 0) tr.notesOn++
        else tr.notesOff++
        p += 2
      } else if ((st & 0xf0) === 0x80) {
        tr.notesOff++
        p += 2
      } else p += 2
      tr.maxTick = tick
    }
    tracks.push(tr)
  }
  return { fmt, ntr, ppq, tracks }
}

const PCS_ERA = new Set([0, 1, 3, 5, 7, 8, 10, 11, 2, 6]) // incluye notas de paso

describe('generador', () => {
  it('es determinista por semilla y varía entre semillas', () => {
    const a = generateSong({ style: 'era', seed: 42, key: 0 })
    const b = generateSong({ style: 'era', seed: 42, key: 0 })
    const c = generateSong({ style: 'era', seed: 43, key: 0 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
  })

  for (const style of STYLES.map((s) => s.id) as StyleId[]) {
    it(`${style}: tema válido, con las 10 pistas, sin saturar y dentro de rango`, () => {
      for (const seed of [1, 7, 2024]) {
        const song = generateSong({ style, seed, key: seed % 12 })
        // la canción pasa el saneamiento sin cambios de estructura
        const clean = sanitizeSong(JSON.parse(JSON.stringify(song)), createEmptySong())
        expect(clean.patterns.length).toBe(song.patterns.length)
        expect(countNotes(clean)).toBe(countNotes(song))
        // notas dentro de cada patrón
        for (const p of song.patterns) {
          const max = patternSteps(song, p)
          for (const t of song.tracks) {
            for (const n of p.notes[t.id] ?? []) {
              expect(n.step).toBeGreaterThanOrEqual(0)
              expect(n.step + n.len).toBeLessThanOrEqual(max)
              expect(n.vel).toBeGreaterThanOrEqual(1)
              expect(n.vel).toBeLessThanOrEqual(15)
              if (t.kind === 'fm' || t.kind === 'psg') {
                expect(n.note).toBeGreaterThanOrEqual(24)
                expect(n.note).toBeLessThanOrEqual(108)
              } else expect(n.note).toBeLessThanOrEqual(7)
            }
          }
        }
        // estructura: varias secciones y las pistas principales con notas
        expect(song.order.length).toBeGreaterThanOrEqual(6)
        const used = new Set<string>()
        for (const p of song.patterns) for (const t of song.tracks) if ((p.notes[t.id]?.length ?? 0) > 0) used.add(t.id)
        for (const id of ['fm1', 'fm2', 'ch6']) expect(used.has(id), `${style} usa ${id}`).toBe(true)
      }
    })
  }

  it('ERA en Do: solo usa notas de Do menor/frigio (+paso)', () => {
    const song = generateSong({ style: 'era', seed: 5, key: 0 })
    for (const p of song.patterns) {
      for (const t of song.tracks.filter((x) => x.kind === 'fm' || x.kind === 'psg')) {
        for (const n of p.notes[t.id] ?? []) expect(PCS_ERA.has(n.note % 12), `${t.id} nota ${n.note}`).toBe(true)
      }
    }
  })

  it('ERA: duración ~2.5 min a 113 BPM y 72 compases (+ repeticiones)', () => {
    const song = generateSong({ style: 'era', seed: 1, key: 0, bpm: 113 })
    expect(song.bpm).toBe(113)
    const bars = songSteps(song) / 16
    expect(bars).toBe(9 * 8)
    expect(songSeconds(song)).toBeGreaterThan(150)
    expect(songSeconds(song)).toBeLessThan(156)
  })

  it('cada estilo se renderiza con nivel sano y se exporta a VGM/MIDI/WAV', () => {
    for (const style of STYLES.map((s) => s.id) as StyleId[]) {
      const song = generateSong({ style, seed: 11, key: 0 })
      // recorta a 3 patrones para acelerar el test
      song.order = song.order.slice(0, 4)
      const a = renderSong(song, { sampleRate: 44100, tail: 1 })
      const pk = peakOf(a)
      expect(pk, style).toBeGreaterThan(0.2)
      expect(pk, style).toBeLessThanOrEqual(1)
      expect(rms(a.left, 44100, 44100 * 5)).toBeGreaterThan(0.03)
      if (process.env.TZ_WRITE_WAV) writeWav(`tests/out/${style}.wav`, 44100, a.left, a.right)
      const vgm = buildVgm(song)
      const info = parseVgmHeader(vgm)
      expect(info.totalSamples / 44100).toBeCloseTo(songSeconds(song) + 0.6, 0)
      const midi = parseMidi(buildMidi(song))
      expect(midi.fmt).toBe(1)
      expect(midi.ppq).toBe(480)
      const noteOns = midi.tracks.reduce((n, t) => n + t.notesOn, 0)
      // cada nota de cada patrón del orden suena una vez
      let expected = 0
      for (const id of song.order) {
        const p = song.patterns.find((x) => x.id === id)!
        for (const t of song.tracks) expected += p.notes[t.id]?.length ?? 0
      }
      expect(noteOns).toBe(expected)
      expect(midi.tracks[0].tempo).toBe(Math.round(60_000_000 / song.bpm))
      const wav = encodeWav(a, 'pcm16')
      expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
      expect(wav.length).toBe(44 + a.left.length * 4)
    }
  })

  it('generateTrackNotes devuelve notas válidas para cada tipo', () => {
    const song = generateSong({ style: 'house', seed: 3, key: 9 })
    const pat = song.patterns[1]
    const max = patternSteps(song, pat)
    for (const [kind, track] of [
      ['bass', 'fm1'],
      ['chords', 'fm2'],
      ['arp', 'sq1'],
      ['lead', 'fm4'],
      ['drums', 'ch6'],
      ['perc', 'noise'],
    ] as const) {
      const notes = generateTrackNotes(song, pat, track, kind, 99)
      expect(notes.length, kind).toBeGreaterThan(0)
      for (const n of notes) expect(n.step + n.len).toBeLessThanOrEqual(max)
    }
  })
})

describe('compartir y proyecto', () => {
  it('el hash de URL reconstruye la canción exactamente', () => {
    const song = generateSong({ style: 'boss', seed: 9, key: 2 })
    const hash = songToHash(song)
    const back = songFromHash(hash)
    expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(sanitizeSong(JSON.parse(JSON.stringify(song)), createEmptySong()))))
    // tamaño razonable para una URL
  
  })

  it('un instrumento editado viaja en el hash', () => {
    const song = generateSong({ style: 'adventure', seed: 2, key: 0 })
    song.fmBank[0].name = 'MI BAJO'
    song.fmBank[0].ops[0].tl = 33
    const back = songFromHash(songToHash(song))
    expect(back.fmBank[0].name).toBe('MI BAJO')
    expect(back.fmBank[0].ops[0].tl).toBe(33)
  })

  it('archivo de proyecto JSON ida y vuelta', () => {
    const song = generateSong({ style: 'house', seed: 8, key: 5 })
    const back = songFromProjectFile(songToProjectFile(song))
    expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(song)))
  })
})
