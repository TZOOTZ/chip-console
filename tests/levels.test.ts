import { describe, expect, it } from 'vitest'
import { peakOf, renderSong } from '../src/export/render'
import { STYLES, generateSong } from '../src/music/generator'

describe('niveles de salida por estilo', () => {
  it('el mezclador deja un nivel profesional: pico ≤ -0.5 dBFS y RMS entre -22 y -12 dBFS', () => {
    for (const style of STYLES.map((s) => s.id)) {
      const song = generateSong({ style, seed: 3, key: 0 })
      song.order = song.order.slice(-3, -1) // secciones más densas
      const a = renderSong(song, { sampleRate: 44100, tail: 0.5 })
      let s = 0
      for (let i = 0; i < a.left.length; i++) s += a.left[i] * a.left[i] + a.right[i] * a.right[i]
      const rmsDb = 20 * Math.log10(Math.sqrt(s / (a.left.length * 2)))
      const peakDb = 20 * Math.log10(peakOf(a))
      expect(peakDb, `${style} pico`).toBeLessThan(-0.5)
      expect(rmsDb, `${style} rms`).toBeGreaterThan(-22)
      expect(rmsDb, `${style} rms`).toBeLessThan(-12)
    }
  })
})
