import { describe, expect, it } from 'vitest'
import { midiToHz, psgHzFromPeriod, psgPeriodFromHz } from '../src/core/chipmath'
import { Synth } from '../src/engine/synth'
import { buildVgm, buildVgz } from '../src/export/vgm'
import { parseVgmHeader, renderVgm } from '../src/export/vgmRead'
import { peakOf, renderSong } from '../src/export/render'
import { createEmptySong } from '../src/music/presets'
import { sanitizeSong, type Note, type Song } from '../src/music/song'
import { peak, peakFreq, rms } from './helpers'

interface N {
  track: string
  step: number
  len: number
  note: number
  vel?: number
}

function songWith(notes: N[], bars = 2, mod?: (s: Song) => void): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = bars
  for (const n of notes) {
    const arr = s.patterns[0].notes[n.track]
    const note: Note = { step: n.step, len: n.len, note: n.note, vel: n.vel ?? 15 }
    arr.push(note)
  }
  mod?.(s)
  return s
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

describe('Synth · tono', () => {
  it('FM: el SINE SUB suena a la nota pedida (±6 cents)', () => {
    for (const note of [36, 40, 48, 55, 60, 67, 72]) {
      const song = songWith([{ track: 'fm1', step: 0, len: 12, note }])
      const a = renderSong(song, { sampleRate: 44100, tail: 0.2 })
      const seg = a.left.subarray(Math.round(0.2 * 44100), Math.round(0.9 * 44100))
      const f = peakFreq(seg, 44100)
      expect(Math.abs(cents(f, midiToHz(note))), `nota ${note}`).toBeLessThan(6)
    }
  })

  it('PSG: el cuadrado suena a la nota (limitado por la resolución del periodo)', () => {
    for (const note of [48, 57, 60, 69, 72, 81]) {
      const song = songWith([{ track: 'sq1', step: 0, len: 12, note }], 2, (s) => {
        s.psgBank[0].vib = undefined
      })
      const a = renderSong(song, { sampleRate: 44100, tail: 0.2 })
      const seg = a.left.subarray(Math.round(0.2 * 44100), Math.round(0.9 * 44100))
      const f = peakFreq(seg, 44100)
      const expected = psgHzFromPeriod(psgPeriodFromHz(midiToHz(note)))
      expect(Math.abs(cents(f, expected)), `nota ${note}`).toBeLessThan(8)
    }
  })

  it('PSG: las notas por debajo de A2 se pliegan una octava arriba', () => {
    const song = songWith([{ track: 'sq1', step: 0, len: 12, note: 36 }], 2, (s) => {
      s.psgBank[0].vib = undefined
    })
    const a = renderSong(song, { sampleRate: 44100, tail: 0.2 })
    const f = peakFreq(a.left.subarray(8820, 39690), 44100)
    expect(f).toBeGreaterThan(105)
    expect(f).toBeLessThan(135) // C3 ≈ 130.8 Hz (C2 plegado)
  })
})

describe('Synth · tiempo', () => {
  it('el inicio de nota cae en el paso exacto', () => {
    // 120 BPM → paso = 5512.5 muestras; nota en el paso 8 (= 1 s)
    const song = songWith([{ track: 'sq1', step: 8, len: 4, note: 69 }], 2, (s) => {
      s.psgBank[0].vib = undefined
    })
    const a = renderSong(song, { sampleRate: 44100, tail: 0.2 })
    let first = -1
    for (let i = 0; i < a.left.length; i++) {
      if (Math.abs(a.left[i]) > 0.005) {
        first = i
        break
      }
    }
    expect(first).toBeGreaterThanOrEqual(44100 - 4)
    expect(first).toBeLessThan(44100 + 400)
  })

  it('la duración de la canción coincide con compases × tempo', () => {
    const song = songWith([{ track: 'sq1', step: 0, len: 1, note: 69 }], 2)
    const a = renderSong(song, { sampleRate: 44100, tail: 0.1 })
    // 2 compases a 120 BPM = 4 s
    const secs = a.left.length / 44100
    expect(secs).toBeGreaterThan(4.0)
    expect(secs).toBeLessThan(4.6)
  })
})

describe('Synth · percusión DAC y ruido', () => {
  it('el bombo del DAC suena con graves y nivel razonable', () => {
    const song = songWith([{ track: 'ch6', step: 0, len: 1, note: 0, vel: 15 }])
    const a = renderSong(song, { sampleRate: 44100, tail: 0.1 })
    const seg = a.left.subarray(0, 8000)
    expect(peak(seg)).toBeGreaterThan(0.1)
    expect(peak(seg)).toBeLessThan(0.5)
    const f = peakFreq(a.left.subarray(300, 4000), 44100, 20)
    expect(f).toBeLessThan(140)
  })

  it('el hat del DAC es más agudo que el bombo', () => {
    const kick = renderSong(songWith([{ track: 'ch6', step: 0, len: 1, note: 0 }]), { tail: 0.1 })
    const hat = renderSong(songWith([{ track: 'ch6', step: 0, len: 1, note: 2 }]), { tail: 0.1 })
    const cent = (x: Float32Array) => {
      let s = 0
      let d = 0
      for (let i = 1; i < 6000; i++) {
        s += Math.abs(x[i] - x[i - 1])
        d += Math.abs(x[i]) + 1e-9
      }
      return s / d
    }
    expect(cent(hat.left)).toBeGreaterThan(cent(kick.left) * 3)
  })

  it('el canal de ruido produce señal y respeta la envolvente (HAT corto)', () => {
    const song = songWith([{ track: 'noise', step: 0, len: 2, note: 0 }])
    const a = renderSong(song, { sampleRate: 44100, tail: 0.1 })
    expect(rms(a.left, 0, 1500)).toBeGreaterThan(0.01)
    expect(rms(a.left, 20000, 30000)).toBeLessThan(0.001)
  })

  it('FM6 se vuelve FM normal si la pista deja de ser DAC', () => {
    const song = songWith([{ track: 'ch6', step: 0, len: 8, note: 60 }], 2, (s) => {
      const t = s.tracks.find((x) => x.id === 'ch6')!
      t.kind = 'fm'
      t.inst = 0
    })
    const a = renderSong(song, { sampleRate: 44100, tail: 0.2 })
    const f = peakFreq(a.left.subarray(8000, 30000), 44100)
    expect(Math.abs(cents(f, midiToHz(60)))).toBeLessThan(8)
  })
})

describe('Synth · pistas', () => {
  it('mute silencia y solo aísla', () => {
    const base = songWith([
      { track: 'fm1', step: 0, len: 12, note: 48 },
      { track: 'sq1', step: 0, len: 12, note: 72 },
    ])
    const full = renderSong(base, { tail: 0.1 })
    const muted = renderSong(
      { ...base, tracks: base.tracks.map((t) => (t.id === 'fm1' ? { ...t, mute: true } : t)) },
      { tail: 0.1 },
    )
    const solo = renderSong(
      { ...base, tracks: base.tracks.map((t) => (t.id === 'fm1' ? { ...t, solo: true } : t)) },
      { tail: 0.1 },
    )
    const seg = (a: { left: Float32Array }) => a.left.subarray(8000, 30000)
    expect(rms(seg(muted))).toBeLessThan(rms(seg(full)))
    expect(rms(seg(solo))).toBeLessThan(rms(seg(full)))
    // el solo del FM tiene el pico en 130 Hz, el mute (solo PSG) en 523 Hz
    expect(peakFreq(seg(solo), 44100)).toBeLessThan(200)
    expect(peakFreq(seg(muted), 44100)).toBeGreaterThan(400)
  })

  it('un acorde en una pista se arpegia (varios tonos en el periodo)', () => {
    const song = songWith(
      [
        { track: 'sq1', step: 0, len: 12, note: 60 },
        { track: 'sq1', step: 0, len: 12, note: 64 },
        { track: 'sq1', step: 0, len: 12, note: 67 },
      ],
      2,
      (s) => {
        s.psgBank[0].vib = undefined
      },
    )
    const synth = new Synth(44100, song)
    const periods = new Set<number>()
    synth.log = (_t, kind, a) => {
      if (kind === 2 && a & 0x80 && !(a & 0x10) && ((a >> 5) & 3) === 0) periods.add(a & 15)
    }
    synth.reset()
    synth.play(0, 0)
    synth.advanceOnly(20000)
    expect(periods.size).toBeGreaterThanOrEqual(3)
  })

  it('notas en directo: liveOn suena y liveOff libera', () => {
    const song = createEmptySong()
    const synth = new Synth(44100, song)
    const L = new Float32Array(8000)
    const R = new Float32Array(8000)
    synth.liveOn(0, 57, 15) // fm1
    synth.render(L, R, 8000)
    expect(rms(L, 3000)).toBeGreaterThan(0.02)
    synth.liveOff(0, 57)
    const L2 = new Float32Array(44100)
    const R2 = new Float32Array(44100)
    synth.render(L2, R2, 44100)
    expect(rms(L2, 40000)).toBeLessThan(0.001)
  })
})

describe('VGM', () => {
  function richSong(): Song {
    const notes: N[] = []
    for (let b = 0; b < 2; b++) {
      for (const s of [0, 3, 6, 8, 11, 14]) notes.push({ track: 'fm1', step: b * 16 + s, len: 2, note: 36 + (b ? 3 : 0), vel: 14 })
      for (const s of [0, 4, 8, 12]) notes.push({ track: 'ch6', step: b * 16 + s, len: 1, note: s % 8 === 0 ? 0 : 1 })
      for (const s of [2, 6, 10, 14]) notes.push({ track: 'ch6', step: b * 16 + s, len: 1, note: 2 })
      for (const s of [0, 4, 8, 12]) {
        notes.push({ track: 'fm2', step: b * 16 + s, len: 4, note: 60 })
        notes.push({ track: 'fm2', step: b * 16 + s, len: 4, note: 63 })
      }
      for (let s = 0; s < 16; s += 2) notes.push({ track: 'sq1', step: b * 16 + s, len: 1, note: 72 + (s % 7), vel: 11 })
      for (const s of [4, 12]) notes.push({ track: 'noise', step: b * 16 + s, len: 1, note: 2 })
    }
    return songWith(notes, 2, (s) => {
      s.patterns[0].notes.fm4 = [{ step: 0, len: 8, note: 72, vel: 13 }]
    })
  }

  it('cabecera válida con GD3, reloj de los chips y duración correcta', () => {
    const song = richSong()
    song.title = 'PRUEBA ñ'
    const vgm = buildVgm(song)
    const info = parseVgmHeader(vgm)
    expect(String.fromCharCode(...vgm.subarray(0, 4))).toBe('Vgm ')
    expect(info.version).toBe(0x171)
    expect(info.ymClock).toBe(7670454)
    expect(info.snClock).toBe(3579545)
    expect(info.gd3[0]).toBe('PRUEBA ñ')
    // 2 compases a 120 BPM = 4 s + cola
    expect(info.totalSamples / 44100).toBeGreaterThan(4.0)
    expect(info.totalSamples / 44100).toBeLessThan(5.2)
  })

  it('el VGM exportado suena IDÉNTICO al render directo del driver', () => {
    const song = richSong()
    const direct = renderSong(song, { sampleRate: 44100, tail: 0.6 })
    const vgm = buildVgm(song, { tail: 0.6 })
    const back = renderVgm(vgm, 44100)
    const n = Math.min(direct.left.length, back.left.length)
    expect(n).toBeGreaterThan(44100 * 4)
    let maxDiff = 0
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(direct.left[i] - back.left[i]), Math.abs(direct.right[i] - back.right[i]))
    expect(maxDiff).toBeLessThan(1e-6)
    expect(peakOf(direct)).toBeGreaterThan(0.1)
  })

  it('VGZ es un gzip del VGM', () => {
    const song = richSong()
    const vgz = buildVgz(song)
    expect(vgz[0]).toBe(0x1f)
    expect(vgz[1]).toBe(0x8b)
    const info = parseVgmHeader(vgz)
    expect(info.totalSamples).toBeGreaterThan(0)
    expect(vgz.length).toBeLessThan(buildVgm(song).length)
  })

  it('el punto de bucle apunta al inicio de loopStart', () => {
    const song = richSong()
    // segundo patrón para tener intro + bucle
    song.patterns.push({
      id: 'p2',
      name: 'B',
      bars: 1,
      notes: Object.fromEntries(song.tracks.map((t) => [t.id, [] as Note[]])),
    })
    song.patterns[1].notes.sq1 = [{ step: 0, len: 4, note: 69, vel: 12 }]
    song.order = ['p1', 'p2']
    song.loopStart = 1
    const vgm = buildVgm(song)
    const info = parseVgmHeader(vgm)
    expect(info.loopOffset).toBeGreaterThan(0)
    // intro = patrón A (2 compases = 4 s); el bucle (patrón B + cola) empieza ahí
    const loopStartSample = info.totalSamples - info.loopSamples
    expect(loopStartSample / 44100).toBeCloseTo(4.0, 1)
  })

  it('sin bucle (loopStart = -1) no hay offset de bucle', () => {
    const song = richSong()
    song.loopStart = -1
    const info = parseVgmHeader(buildVgm(song))
    expect(info.loopOffset).toBe(0)
  })
})

describe('Canción · saneamiento', () => {
  it('sanitizeSong repara datos inválidos sin romper', () => {
    const base = createEmptySong()
    const dirty = {
      bpm: 9999,
      swing: -3,
      beatsPerBar: 1,
      scale: 'minor',
      tracks: [{ id: 'fm1', vol: 500, gate: 5 }],
      patterns: [
        { id: 'x', bars: 99, notes: { fm1: [{ step: -5, len: 2, note: 60 }, { step: 3, len: 0, note: 400, vel: 99 }, 'basura'] } },
      ],
      order: ['x', 'nope'],
    }
    const s = sanitizeSong(dirty, base)
    expect(s.bpm).toBe(300)
    expect(s.swing).toBe(0)
    expect(s.beatsPerBar).toBe(2)
    expect(s.tracks.length).toBe(10)
    expect(s.tracks[0].vol).toBe(100)
    expect(s.patterns[0].bars).toBe(32)
    expect(s.patterns[0].notes.fm1.length).toBe(1)
    expect(s.patterns[0].notes.fm1[0].note).toBe(127)
    expect(s.patterns[0].notes.fm1[0].vel).toBe(15)
    expect(s.order).toEqual(['x'])
  })
})

describe('LFO hardware', () => {
  it('con PMS>0 y LFO activo el tono vibra; con LFO apagado no', () => {
    const make = (lfo: number) =>
      songWith([{ track: 'fm1', step: 0, len: 12, note: 57 }], 2, (s) => {
        s.lfo = lfo
        s.fmBank[0].pms = 7
        s.fmBank[0].vib = undefined
      })
    const spread = (song: Song) => {
      const a = renderSong(song, { sampleRate: 44100, tail: 0.2 })
      const fs: number[] = []
      for (let i = 4000; i + 4096 < 40000; i += 2048) fs.push(peakFreq(a.left.subarray(i, i + 4096), 44100, 80, 1 << 15))
      return 1200 * Math.log2(Math.max(...fs) / Math.min(...fs))
    }
    expect(spread(make(0))).toBeLessThan(15)
    expect(spread(make(6))).toBeGreaterThan(40)
  })

  it('el registro 0x22 sale en el VGM cuando el LFO está activo', () => {
    const song = songWith([{ track: 'fm1', step: 0, len: 4, note: 57 }], 1, (s) => {
      s.lfo = 3
    })
    const vgm = buildVgm(song)
    let found = false
    for (let i = 0x100; i < vgm.length - 2; i++) if (vgm[i] === 0x52 && vgm[i + 1] === 0x22 && vgm[i + 2] === 0x0a) found = true
    expect(found).toBe(true)
  })
})
