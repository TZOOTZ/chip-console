import { describe, expect, it } from 'vitest'
import { SCOPE_KINDS, exportParts, partFileName, patternSong, slug } from '../src/export/escopo'
import { buildMidi } from '../src/export/midi'
import { renderSong } from '../src/export/render'
import { buildVgm } from '../src/export/vgm'
import { parseVgmHeader } from '../src/export/vgmRead'
import { buildXgm } from '../src/export/xgm'
import { generateSong } from '../src/music/generator'
import { songSeconds, type Song } from '../src/music/song'

/** notas ON de cada pista de un MIDI SMF1 (sin la de tempo) */
function midiNoteOns(b: Uint8Array): number[] {
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  const ntr = (b[10] << 8) | b[11]
  const out: number[] = []
  let p = 14
  for (let t = 0; t < ntr; t++) {
    const end = p + 8 + u32(p + 4)
    p += 8
    let run = 0
    let ons = 0
    while (p < end) {
      let c: number
      do c = b[p++]
      while (c & 0x80)
      let st = b[p]
      if (st & 0x80) {
        p++
        run = st
      } else st = run
      if (st === 0xff) {
        p++
        let l = 0
        do {
          c = b[p++]
          l = (l << 7) | (c & 0x7f)
        } while (c & 0x80)
        p += l
      } else if ((st & 0xf0) === 0x90) {
        if (b[p + 1] > 0) ons++
        p += 2
      } else if ((st & 0xf0) === 0x80 || (st & 0xf0) === 0xb0 || (st & 0xf0) === 0xe0) p += 2
      else p += 1
    }
    if (t > 0) out.push(ons)
  }
  return out
}

const countNotes = (song: Song, id: string): number => Object.values(song.patterns.find((p) => p.id === id)!.notes).reduce((n, a) => n + a.length, 0)

describe('exportar por patrón', () => {
  const song = generateSong({ style: 'cosmic', seed: 4, key: 9, bars: 4 })

  it('patternSong: una canción de un solo patrón en bucle, sin tocar la original', () => {
    const before = JSON.stringify(song)
    const b = song.patterns[2]
    const one = patternSong(song, b.id)
    expect(one.patterns).toEqual([b])
    expect(one.order).toEqual([b.id])
    expect(one.loopStart).toBe(0)
    expect(one.title).toBe(`${song.title} · ${b.name}`.slice(0, 40))
    expect(one.tracks).toEqual(song.tracks)
    expect(one.fmBank).toEqual(song.fmBank)
    expect(one.drumKit).toEqual(song.drumKit)
    expect(JSON.stringify(song)).toBe(before)
    // un patrón que no existe cae en el primero
    expect(patternSong(song, 'no-existe').order).toEqual([song.patterns[0].id])
  })

  it('exportParts: canción, patrón seleccionado y todos los patrones con notas', () => {
    expect(exportParts(song, 'song', 'p1')).toEqual([{ label: '', song }])
    const sel = exportParts(song, 'pattern', song.patterns[3].id)
    expect(sel.map((p) => p.label)).toEqual([song.patterns[3].name])
    expect(sel[0].song.order).toEqual([song.patterns[3].id])
    expect(exportParts(song, 'patterns', 'p1').map((p) => p.label)).toEqual(song.patterns.map((p) => p.name))
    // un patrón vacío no da archivo; si todos están vacíos, salen todos
    const s2: Song = JSON.parse(JSON.stringify(song))
    for (const t of s2.tracks) s2.patterns[1].notes[t.id] = []
    expect(exportParts(s2, 'patterns', 'p1').map((p) => p.label)).toEqual(s2.patterns.filter((_, i) => i !== 1).map((p) => p.name))
    for (const p of s2.patterns) for (const t of s2.tracks) p.notes[t.id] = []
    expect(exportParts(s2, 'patterns', 'p1')).toHaveLength(s2.patterns.length)
  })

  it('los nombres de archivo no chocan aunque los patrones se llamen casi igual', () => {
    expect(slug('Cañón y vermú · Ñandú')).toBe('Canon_y_vermu_Nandu')
    expect(slug('')).toBe('tzootz')
    const names = ['A', 'a', 'A?', 'LO MISMO QUE LA OTRA ENORME', 'LO MISMO QUE LA OTRA ENORME 2'].map((l, i, all) => partFileName('MI TEMA', l, i, all.length, '.wav'))
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toBe('MI_TEMA_01_A.wav')
    expect(partFileName('MI TEMA', 'B', 0, 1, '.mid')).toBe('MI_TEMA_B.mid')
    expect(SCOPE_KINDS.patterns).not.toContain('rom')
    expect(SCOPE_KINDS.patterns).not.toContain('project')
    expect(SCOPE_KINDS.pattern).toContain('rom')
  })

  it('el WAV de un patrón dura lo que el patrón y con dos vueltas, el doble', () => {
    const p = song.patterns[1]
    const one = patternSong(song, p.id)
    const sec = songSeconds(one)
    const a = renderSong(one, { sampleRate: 22050, tail: 0.3 })
    expect(a.left.length / 22050).toBeGreaterThan(sec - 0.1)
    expect(a.left.length / 22050).toBeLessThan(sec + 1.5)
    const b = renderSong(one, { sampleRate: 22050, loops: 2, tail: 0.3 })
    expect(b.left.length / 22050).toBeGreaterThan(2 * sec - 0.1)
    expect(b.left.length / 22050).toBeLessThan(2 * sec + 1.5)
  })

  it('el VGM de un patrón queda en bucle, el XGM se compila y el MIDI lleva solo sus notas', () => {
    const p = song.patterns[2]
    const one = patternSong(song, p.id)
    const info = parseVgmHeader(buildVgm(one))
    expect(info.loopSamples).toBeGreaterThan(0)
    expect(info.totalSamples / 44100).toBeCloseTo(songSeconds(one) + 0.6, 0)
    expect(buildXgm(one).length).toBeGreaterThan(100)
    const ons = midiNoteOns(buildMidi(one)).reduce((n, x) => n + x, 0)
    expect(ons).toBe(countNotes(song, p.id))
  })

  it('MUTE y SOLO cuentan: el MIDI y el WAV de un patrón dejan fuera lo silenciado', () => {
    const p = song.patterns[2]
    const one = patternSong(song, p.id)
    const total = midiNoteOns(buildMidi(one)).reduce((n, x) => n + x, 0)
    const mute: Song = JSON.parse(JSON.stringify(one))
    mute.tracks.find((t) => t.id === 'fm1')!.mute = true
    const fm1 = one.patterns[0].notes.fm1.length
    expect(fm1).toBeGreaterThan(0)
    expect(midiNoteOns(buildMidi(mute)).reduce((n, x) => n + x, 0)).toBe(total - fm1)
    const solo: Song = JSON.parse(JSON.stringify(one))
    solo.tracks.find((t) => t.id === 'fm1')!.solo = true
    expect(midiNoteOns(buildMidi(solo)).reduce((n, x) => n + x, 0)).toBe(fm1)
    // todo silenciado: el WAV es silencio
    const quiet: Song = JSON.parse(JSON.stringify(one))
    for (const t of quiet.tracks) t.mute = true
    const a = renderSong(quiet, { sampleRate: 22050, tail: 0.2 })
    expect(a.left.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(1e-3)
  })
})
