import { describe, expect, it } from 'vitest'
import { songFromHash, songToHash } from '../src/export/share'
import { FIRST_LAYER, REVEAL_ORDER, layerIntro, layerState, listNames, revealAll, revealNext, revealOrder, startLayers } from '../src/music/capas'
import { STYLES, generateSong, type StyleId } from '../src/music/generator'
import { PIECES, generatePiece, type PieceId } from '../src/music/piezas'
import type { Song } from '../src/music/song'

const withNotes = (s: Song): string[] => s.tracks.filter((t) => s.patterns.some((p) => (p.notes[t.id]?.length ?? 0) > 0)).map((t) => t.id)
const ids = (s: Song, idx: number[]): string[] => idx.map((i) => s.tracks[i].id)

const songs: [string, Song][] = [
  ...STYLES.map((st): [string, Song] => [st.id, generateSong({ style: st.id as StyleId, seed: 7, key: 0, bars: 4 })]),
  ...PIECES.map((pc): [string, Song] => [pc.id, generatePiece({ piece: pc.id as PieceId, seed: 7, key: 0 })]),
]

describe('generar por capas', () => {
  it('la primera capa es batería, bajo, tema y armonía principal en todos los estilos y piezas', () => {
    for (const [name, s] of songs) {
      const first = ids(s, revealOrder(s)).slice(0, FIRST_LAYER)
      // bajo y tema siempre; la batería delante si la pieza la lleva (la giga de corte no)
      expect(first, name).toEqual(REVEAL_ORDER.filter((id) => withNotes(s).includes(id)).slice(0, FIRST_LAYER))
      expect(first, name).toEqual(expect.arrayContaining(['fm1', 'fm4']))
      if (withNotes(s).includes('ch6')) expect(first[0], name).toBe('ch6')
    }
  })

  it('al empezar suenan 4 pistas, las demás con notas esperan en mute y las vacías no se tocan', () => {
    for (const [name, s] of songs) {
      const first = startLayers(s)
      expect(first, name).toHaveLength(FIRST_LAYER)
      const st = layerState(s)
      expect(st.sounding, name).toBe(FIRST_LAYER)
      expect(st.total, name).toBe(withNotes(s).length)
      for (const t of s.tracks) {
        const waiting = withNotes(s).includes(t.id) && !first.includes(s.tracks.indexOf(t))
        expect(t.mute, `${name} ${t.id}`).toBe(waiting)
        expect(t.solo).toBe(false)
      }
    }
  })

  it('SIGUIENTE suma una pista cada vez, en orden de arreglo, hasta que suenan todas', () => {
    const s = generatePiece({ piece: 'maestoso', seed: 3, key: 2 })
    startLayers(s)
    const order = ids(s, revealOrder(s))
    const added: string[] = []
    let k: number | null
    while ((k = revealNext(s)) !== null) added.push(s.tracks[k].id)
    expect(added).toEqual(order.slice(FIRST_LAYER))
    expect(layerState(s)).toEqual({ sounding: order.length, total: order.length, next: null })
  })

  it('TODAS quita el mute de golpe y un mute puesto a mano vuelve a contar como "en espera"', () => {
    const s = generateSong({ style: 'cosmic', seed: 3, key: 9, bars: 4 })
    startLayers(s)
    revealAll(s)
    expect(layerState(s).next).toBeNull()
    s.tracks.find((t) => t.id === 'sq2')!.mute = true
    expect(s.tracks[layerState(s).next!].id).toBe('sq2')
  })

  it('las pistas en espera viajan en el enlace como mute', () => {
    const s = generatePiece({ piece: 'fanfare', seed: 5, key: 0 })
    startLayers(s)
    const back = songFromHash(songToHash(s))!
    expect(back.tracks.map((t) => t.mute)).toEqual(s.tracks.map((t) => t.mute))
  })

  it('el aviso dice qué suena y cuántas pistas esperan', () => {
    const s = generatePiece({ piece: 'fanfare', seed: 5, key: 0 })
    const waiting = withNotes(s).length - FIRST_LAYER
    const names = ids(s, revealOrder(s).slice(0, FIRST_LAYER)).map((id) => s.tracks.find((t) => t.id === id)!.name)
    expect(layerIntro(s)).toBe(` · suenan ${names.slice(0, 3).join(', ')} y ${names[3]}; + SIGUIENTE suma las otras ${waiting}`)
    const small = generatePiece({ piece: 'bourree', seed: 5, key: 0 })
    for (const t of small.tracks) if (!['ch6', 'fm1', 'fm4', 'fm2', 'fm3'].includes(t.id)) for (const p of small.patterns) p.notes[t.id] = []
    expect(layerIntro(small)).toMatch(/SIGUIENTE suma la otra$/)
  })

  it('lista los nombres en castellano', () => {
    expect(listNames(['A'])).toBe('A')
    expect(listNames(['A', 'B'])).toBe('A y B')
    expect(listNames(['A', 'B', 'C', 'D'])).toBe('A, B, C y D')
  })
})
