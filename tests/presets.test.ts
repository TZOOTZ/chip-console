import { describe, expect, it } from 'vitest'
import { renderSong } from '../src/export/render'
import { createEmptySong } from '../src/music/presets'
import type { Song } from '../src/music/song'
import { db, peak, peakFreq, rms, spectralCentroid } from './helpers'

function oneNote(track: string, note: number, steps: number, mod: (s: Song) => void): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 2
  s.patterns[0].notes[track] = [{ step: 0, len: steps, note, vel: 15 }]
  mod(s)
  return s
}

describe('auditoría de presets', () => {
  it('FM: todos suenan, sin saturar y con carácter distinto', () => {
    const base = createEmptySong()
    const rows: string[] = []
    const centroids: number[] = []
    base.fmBank.forEach((p, i) => {
      const note = p.name.includes('BASS') || p.name.includes('SUB') || p.name.includes('GROWL') || p.name.includes('KICK') ? 36 : 60
      const song = oneNote('fm1', note, 8, (s) => {
        s.tracks[0].inst = i
        s.tracks[0].gate = 0.95
      })
      const a = renderSong(song, { sampleRate: 44100, tail: 0.3 })
      const x = a.left
      const pk = peak(x)
      const r = rms(x, 2000, 22000)
      const cen = spectralCentroid(x.subarray(2000, 2000 + 16384), 44100)
      const f0 = peakFreq(x.subarray(2000, 2000 + 16384), 44100)
      // decaimiento: nivel a 0.1 s vs a 0.8 s
      const early = rms(x, 4410, 6615)
      const late = rms(x, 35280, 37485)
      centroids.push(cen)
      rows.push(
        `${String(i).padStart(2)} ${p.name.padEnd(12)} pk ${pk.toFixed(2)} (${db(pk).toFixed(1)}dB) rms ${db(r).toFixed(1)}dB  f0 ${f0.toFixed(0).padStart(4)}Hz  cent ${cen.toFixed(0).padStart(5)}Hz  decay ${db(late / (early + 1e-9)).toFixed(1)}dB`,
      )
      expect(pk, `${p.name} silencioso`).toBeGreaterThan(0.03)
      expect(pk, `${p.name} satura`).toBeLessThan(0.95)
    })
    console.log('\nFM presets\n' + rows.join('\n'))
    expect(Math.max(...centroids) / Math.min(...centroids)).toBeGreaterThan(2)
  })

  it('PSG: todos los instrumentos suenan a nivel razonable', () => {
    const base = createEmptySong()
    const rows: string[] = []
    base.psgBank.forEach((p, i) => {
      const song = oneNote('sq1', 72, 8, (s) => {
        s.tracks[6].inst = i
        s.tracks[6].gate = 0.95
      })
      const a = renderSong(song, { sampleRate: 44100, tail: 0.3 })
      const pk = peak(a.left)
      rows.push(`${i} ${p.name.padEnd(8)} pk ${pk.toFixed(3)} (${db(pk).toFixed(1)}dB)`)
      // el PSG está calibrado 10,9 dB por debajo de un canal FM, como en la consola
      expect(pk).toBeGreaterThan(0.008)
      expect(pk).toBeLessThan(0.5)
    })
    console.log('\nPSG presets\n' + rows.join('\n'))
  })

  it('Ruido y batería DAC: niveles', () => {
    const base = createEmptySong()
    const rows: string[] = []
    base.noiseKit.forEach((v, i) => {
      const song = oneNote('noise', i, 2, () => {})
      const a = renderSong(song, { sampleRate: 44100, tail: 0.3 })
      rows.push(`noise ${v.name.padEnd(9)} pk ${peak(a.left).toFixed(3)}`)
      expect(peak(a.left)).toBeGreaterThan(0.02)
    })
    base.drumKit.forEach((v, i) => {
      const song = oneNote('ch6', i, 1, () => {})
      const a = renderSong(song, { sampleRate: 44100, tail: 0.3 })
      const pk = peak(a.left)
      rows.push(`drum  ${v.name.padEnd(9)} pk ${pk.toFixed(3)}  cent ${spectralCentroid(a.left.subarray(0, 8192), 44100).toFixed(0)}Hz`)
      expect(pk).toBeGreaterThan(0.05)
      expect(pk).toBeLessThan(0.6)
    })
    console.log('\nNoise / drums\n' + rows.join('\n'))
  })
})
