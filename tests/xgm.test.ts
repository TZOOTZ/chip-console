import { describe, expect, it } from 'vitest'
import { buildXgm } from '../src/export/xgm'
import { captureWrites } from '../src/export/vgm'
import { createEmptySong } from '../src/music/presets'
import { generateSong } from '../src/music/generator'
import type { Note, Song } from '../src/music/song'

/** lector XGM de referencia basado en la especificación v1.01 */
function parseXgm(b: Uint8Array) {
  const u16 = (o: number) => b[o] | (b[o + 1] << 8)
  const u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
  expect(String.fromCharCode(...b.subarray(0, 4))).toBe('XGM ')
  const slen = u16(0x100)
  expect(b[0x102]).toBe(1)
  expect(b[0x103]).toBe(0)
  const table: { addr: number; size: number }[] = []
  for (let i = 0; i < 63; i++) {
    const a = u16(4 + i * 4)
    const s = u16(6 + i * 4)
    if (a !== 0xffff) table.push({ addr: a * 256, size: s * 256 })
  }
  const sampleStart = 0x104
  const mlenPos = sampleStart + slen * 256
  const mlen = u32(mlenPos)
  const mus = b.subarray(mlenPos + 4, mlenPos + 4 + mlen)
  let frames = 0
  const counts = { psg: 0, ym0: 0, ym1: 0, key: 0, pcm: 0 }
  const pcmIds: number[] = []
  let loop = -1
  let end = false
  let p = 0
  while (p < mus.length && !end) {
    const c = mus[p]
    const hi = c & 0xf0
    const n = (c & 0x0f) + 1
    if (c === 0x00) {
      frames++
      p++
    } else if (hi === 0x10) {
      counts.psg += n
      p += 1 + n
    } else if (hi === 0x20) {
      counts.ym0 += n
      p += 1 + 2 * n
    } else if (hi === 0x30) {
      counts.ym1 += n
      p += 1 + 2 * n
    } else if (hi === 0x40) {
      counts.key += n
      p += 1 + n
    } else if (hi === 0x50) {
      counts.pcm++
      pcmIds.push(mus[p + 1])
      p += 2
    } else if (c === 0x7e) {
      loop = mus[p + 1] | (mus[p + 2] << 8) | (mus[p + 3] << 16)
      p += 4
      end = true
    } else if (c === 0x7f) {
      p++
      end = true
    } else throw new Error(`opcode inválido ${c.toString(16)} en ${p}`)
  }
  expect(end).toBe(true)
  return { slen, table, mlen, frames, counts, pcmIds, loop, consumed: p, total: mus.length }
}

function songWith(notes: { track: string; step: number; len: number; note: number }[], bars = 2): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = bars
  for (const n of notes) s.patterns[0].notes[n.track].push({ step: n.step, len: n.len, note: n.note, vel: 14 } as Note)
  return s
}

describe('XGM', () => {
  it('estructura válida: cabecera, muestras alineadas a 256, comandos bien formados', () => {
    const song = songWith([
      { track: 'fm1', step: 0, len: 4, note: 36 },
      { track: 'fm2', step: 0, len: 8, note: 60 },
      { track: 'sq1', step: 4, len: 4, note: 72 },
      { track: 'ch6', step: 0, len: 1, note: 0 },
      { track: 'ch6', step: 4, len: 1, note: 1 },
      { track: 'ch6', step: 8, len: 1, note: 2 },
      { track: 'noise', step: 2, len: 1, note: 0 },
    ])
    const x = parseXgm(buildXgm(song))
    expect(x.counts.pcm).toBe(3)
    expect(x.table.length).toBe(3)
    for (const t of x.table) {
      expect(t.addr % 256).toBe(0)
      expect(t.size % 256).toBe(0)
    }
    expect(x.pcmIds.every((id) => id >= 1 && id <= x.table.length)).toBe(true)
    expect(x.counts.psg).toBeGreaterThan(0)
    expect(x.counts.key).toBeGreaterThan(0)
    expect(x.counts.ym0).toBeGreaterThan(0)
    // 2 compases a 120 BPM = 4 s ≈ 240 frames (+ cola)
    expect(x.frames).toBeGreaterThan(240)
    expect(x.frames).toBeLessThan(300)
    expect(x.consumed).toBe(x.total)
  })

  it('no emite escrituras de DAC crudo (0x2A/0x2B) y conserva todas las demás', () => {
    const song = songWith([
      { track: 'fm1', step: 0, len: 4, note: 36 },
      { track: 'ch6', step: 0, len: 1, note: 0 },
    ])
    const cap = captureWrites(song, 0.6)
    let ymNonDac = 0
    let keys = 0
    let psg = 0
    for (let i = 0; i < cap.events.length; i += 4) {
      const kind = cap.events[i + 1]
      const reg = cap.events[i + 2]
      if (kind === 2) psg++
      else if (kind === 0 && reg === 0x28) keys++
      else if (!(kind === 0 && (reg === 0x2a || reg === 0x2b))) ymNonDac++
    }
    const x = parseXgm(buildXgm(song))
    expect(x.counts.ym0 + x.counts.ym1).toBe(ymNonDac)
    expect(x.counts.key).toBe(keys)
    // del PSG solo se descarta una atenuación que otra del mismo canal pisa en el mismo frame
    expect(x.counts.psg).toBeLessThanOrEqual(psg)
    expect(x.counts.psg).toBeGreaterThan(psg - 6)
  })

  it('el bucle apunta dentro del bloque de música', () => {
    const song = generateSong({ style: 'house', seed: 3, key: 0, bars: 4 })
    song.order = song.order.slice(0, 3)
    song.loopStart = 1
    const x = parseXgm(buildXgm(song))
    expect(x.loop).toBeGreaterThan(0)
    expect(x.loop).toBeLessThan(x.total)
  })
})
