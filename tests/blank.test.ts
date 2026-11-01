// ── Tema nuevo desde cero ───────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import { songFromHash, songToHash } from '../src/export/share'
import { STYLES, createBlankSong, generateSong, generateTrackNotes } from '../src/music/generator'
import { createEmptySong } from '../src/music/presets'
import { patternSteps } from '../src/music/song'
import { useApp } from '../src/state/store'

const base = { bpm: 126, beatsPerBar: 4, key: 7, scale: 'minor' as const, bars: 8 }

describe('tema en blanco', () => {
  it('un único patrón vacío con el título, tempo, compás, tono y compases pedidos', () => {
    const song = createBlankSong({ ...base, title: '  NOCHE EN ORIÓN  ', beatsPerBar: 3, scale: 'phrygian', palette: 'basic' })
    expect(song.title).toBe('NOCHE EN ORIÓN')
    expect(song.bpm).toBe(126)
    expect(song.beatsPerBar).toBe(3)
    expect(song.key).toBe(7)
    expect(song.scale).toBe('phrygian')
    expect(song.patterns).toHaveLength(1)
    expect(song.patterns[0].bars).toBe(8)
    expect(song.patterns[0].name).toBe('A')
    expect(patternSteps(song, song.patterns[0])).toBe(8 * 12)
    expect(song.order).toEqual([song.patterns[0].id])
    expect(song.loopStart).toBe(0)
    expect(Object.keys(song.patterns[0].notes).sort()).toEqual(song.tracks.map((t) => t.id).sort())
    for (const t of song.tracks) expect(song.patterns[0].notes[t.id]).toEqual([])
  })

  it('BÁSICO es el banco de fábrica tal cual', () => {
    const song = createBlankSong({ ...base, palette: 'basic' })
    const factory = createEmptySong()
    expect(song.tracks).toEqual(factory.tracks)
    expect(song.drumKit).toEqual(factory.drumKit)
    expect(song.fmBank).toEqual(factory.fmBank)
    expect(song.title).toBe('SIN TÍTULO')
  })

  it('la paleta de un estilo trae su reparto de pistas, sus sonidos y su kit, sin una sola nota', () => {
    for (const style of STYLES.map((s) => s.id)) {
      const song = createBlankSong({ ...base, palette: style })
      const ref = generateSong({ style, seed: 1, key: base.key, bars: 4 })
      expect(song.tracks.map((t) => [t.id, t.name, t.inst, t.vol, t.pan, t.gate]), style).toEqual(ref.tracks.map((t) => [t.id, t.name, t.inst, t.vol, t.pan, t.gate]))
      expect(song.drumKit, style).toEqual(ref.drumKit)
      expect(song.lfo).toBe(ref.lfo)
      expect(song.patterns).toHaveLength(1)
      expect(song.patterns[0].id).toBe('p1')
      for (const t of song.tracks) expect(song.patterns[0].notes[t.id], style).toEqual([])
      // lo que se pidió manda sobre lo que traía el estilo
      expect([song.bpm, song.key, song.scale, song.patterns[0].bars]).toEqual([126, 7, 'minor', 8])
      expect(song.title).toBe('SIN TÍTULO')
      // y el enlace compartido lo reconstruye igual
      const back = songFromHash(songToHash(song))
      expect(back.tracks.map((t) => [t.name, t.inst])).toEqual(song.tracks.map((t) => [t.name, t.inst]))
      expect(back.patterns[0].bars).toBe(8)
    }
  })

  it('la paleta COSMIC afina los timbales a la tónica elegida', () => {
    const a = createBlankSong({ ...base, key: 0, palette: 'cosmic' })
    const b = createBlankSong({ ...base, key: 5, palette: 'cosmic' })
    expect(a.drumKit[6].kind).toBe('timp')
    expect(Math.round((b.drumKit[6].pitch - a.drumKit[6].pitch) * 24)).toBe(5)
  })

  it('sanea los valores fuera de rango', () => {
    const song = createBlankSong({ title: 'X'.repeat(80), bpm: 999, beatsPerBar: 12, key: 40, scale: 'minor', bars: 500, palette: 'basic' })
    expect(song.title).toHaveLength(40)
    expect(song.bpm).toBe(300)
    expect(song.beatsPerBar).toBe(7)
    expect(song.key).toBe(11)
    expect(song.patterns[0].bars).toBe(32)
    const low = createBlankSong({ bpm: 1, beatsPerBar: 0, key: -3, scale: 'major', bars: 0, palette: 'basic' })
    expect([low.bpm, low.beatsPerBar, low.key, low.patterns[0].bars]).toEqual([30, 2, 0, 1])
  })

  it('se puede empezar a componer encima: rellenar pistas funciona en el patrón vacío', () => {
    const song = createBlankSong({ ...base, palette: 'cosmic' })
    const p = song.patterns[0]
    for (const [kind, track] of [
      ['bass', 'fm1'],
      ['chords', 'fm2'],
      ['arp', 'sq1'],
      ['lead', 'fm4'],
      ['drums', 'ch6'],
      ['perc', 'ch6'],
      ['perc', 'noise'],
    ] as const) {
      const notes = generateTrackNotes(song, p, track, kind, 11, 'cosmic')
      expect(notes.length, `${kind} → ${track}`).toBeGreaterThan(0)
      for (const n of notes) expect(n.step + n.len).toBeLessThanOrEqual(patternSteps(song, p))
    }
  })

  it('en la app: sustituye el tema y Ctrl+Z recupera el anterior', () => {
    const st = useApp.getState()
    const before = generateSong({ style: 'dark', seed: 5, key: 2 })
    st.replaceSong(before)
    const blank = createBlankSong({ ...base, title: 'NUEVO', palette: 'minimal' })
    useApp.getState().replaceSong(blank, { keepHistory: true })
    expect(useApp.getState().song.title).toBe('NUEVO')
    expect(useApp.getState().selPattern).toBe(blank.patterns[0].id)
    useApp.getState().undo()
    expect(useApp.getState().song.title).toBe(before.title)
    useApp.getState().redo()
    expect(useApp.getState().song.patterns).toHaveLength(1)
  })
})
