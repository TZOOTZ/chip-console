import { describe, expect, it } from 'vitest'
import { renderSong } from '../src/export/render'
import { STYLES, generateSong } from '../src/music/generator'
import { magnitudeSpectrum } from './helpers'

describe('QA de audio', () => {
  for (const style of STYLES.map((s) => s.id)) {
    it(`${style}: sin deriva de continua, sin subsónico fuerte y con pocos saltos bruscos`, () => {
      const song = generateSong({ style, seed: 21, key: 0 })
      song.order = song.order.slice(1, 5)
      const a = renderSong(song, { sampleRate: 44100, tail: 1 })
      const x = a.left
      // continua por ventanas de 1 s
      let maxDc = 0
      for (let i = 0; i + 44100 <= x.length; i += 44100) {
        let s = 0
        for (let k = 0; k < 44100; k++) s += x[i + k]
        maxDc = Math.max(maxDc, Math.abs(s / 44100))
      }
      // saltos entre muestras
      let big = 0
      let maxJump = 0
      for (let i = 1; i < x.length; i++) {
        const d = Math.abs(x[i] - x[i - 1])
        if (d > maxJump) maxJump = d
        if (d > 0.35) big++
      }
      // energía subsónica (<25 Hz) frente al total, en un tramo de 2^17 muestras
      const seg = x.subarray(44100, 44100 + (1 << 17))
      const mag = magnitudeSpectrum(seg, 1 << 17)
      let sub = 0
      let tot = 0
      const binHz = 44100 / (1 << 17)
      for (let i = 1; i < mag.length; i++) {
        const e = mag[i] * mag[i]
        tot += e
        if (i * binHz < 25) sub += e
      }
      const subDb = 10 * Math.log10(sub / tot + 1e-12)
      console.log(`${style.padEnd(10)} DC máx ${maxDc.toFixed(4)} · salto máx ${maxJump.toFixed(2)} · saltos>0.35: ${big} · subsónico ${subDb.toFixed(1)} dB`)
      expect(maxDc).toBeLessThan(0.01)
      expect(subDb).toBeLessThan(-25)
      expect(maxJump).toBeLessThan(1.2)
    })
  }
})
