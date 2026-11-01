import { describe, expect, it } from 'vitest'
import { songToHash } from '../src/export/share'
import { STYLES, generateSong } from '../src/music/generator'

describe('tamaño de los enlaces compartidos', () => {
  it('un tema completo cabe en una URL de < 8 KB', () => {
    for (const style of STYLES.map((s) => s.id)) {
      const song = generateSong({ style, seed: 7, key: 0 })
      expect(songToHash(song).length, style).toBeLessThan(8000)
    }
  })
})
