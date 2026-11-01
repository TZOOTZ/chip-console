import { describe, expect, it } from 'vitest'
import { buildVgm } from '../src/export/vgm'
import { renderSong } from '../src/export/render'
import { generateSong } from '../src/music/generator'
import { Synth } from '../src/engine/synth'

describe('rendimiento', () => {
  it('render offline de un tema completo mucho más rápido que tiempo real', () => {
    const song = generateSong({ style: 'era', seed: 1, key: 0, bpm: 113 })
    const t0 = performance.now()
    const a = renderSong(song, { sampleRate: 44100, tail: 2 })
    const ms = performance.now() - t0
    const secs = a.left.length / 44100
    console.log(`render ${secs.toFixed(1)} s de audio en ${ms.toFixed(0)} ms (x${(secs * 1000 / ms).toFixed(0)} tiempo real)`)
    expect(ms).toBeLessThan(secs * 1000 * 0.25)
  })

  it('VGM completo en un instante', () => {
    const song = generateSong({ style: 'house', seed: 1, key: 0 })
    const t0 = performance.now()
    const vgm = buildVgm(song)
    const ms = performance.now() - t0
    console.log(`VGM ${(vgm.length / 1024).toFixed(0)} KB en ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(3000)
  })

  it('coste por bloque de 128 muestras en el hilo de audio (peor caso, todo sonando)', () => {
    const song = generateSong({ style: 'era', seed: 1, key: 0 })
    const synth = new Synth(48000, song)
    synth.play(0, 0)
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    // salta a la sección FINAL (todo activo)
    const idx = song.order.findIndex((id) => song.patterns.find((p) => p.id === id)?.name === 'FINAL')
    synth.play(idx, 0)
    for (let i = 0; i < 200; i++) synth.render(L, R, 128)
    const blocks = 3000
    const t0 = performance.now()
    let worst = 0
    for (let i = 0; i < blocks; i++) {
      const b0 = performance.now()
      synth.render(L, R, 128)
      worst = Math.max(worst, performance.now() - b0)
    }
    const per = (performance.now() - t0) / blocks
    const budget = (128 / 48000) * 1000
    console.log(`bloque: media ${per.toFixed(3)} ms · peor ${worst.toFixed(2)} ms · presupuesto ${budget.toFixed(2)} ms (uso ${((per / budget) * 100).toFixed(1)} %)`)
    expect(per).toBeLessThan(budget * 0.4)
  })
})
