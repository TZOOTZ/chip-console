// ── Medida de la mezcla por roles: cada pista sola, en LUFS, frente al tema ──
import { Synth } from '../engine/synth'
import { integratedLufs } from './loudness'
import { leadName, roleOf, trimKey, type MixRole } from '../music/mezcla'
import type { Song } from '../music/song'

export interface RoleReading {
  /** clave de la tabla de mezcla ("pista:instrumento") */
  key: string
  id: string
  role: MixRole
  /** LU respecto al tema (fm4) */
  rel: number
  vol: number
  /** instrumento del tema */
  lead: string
}

const hasNotes = (song: Song, id: string, from: number, n: number): boolean =>
  song.order.slice(from, from + n).some((pid) => (song.patterns.find((p) => p.id === pid)?.notes[id]?.length ?? 0) > 0)

/**
 * tramo de medida: desde el punto del orden en el que suenan más pistas en las cuatro secciones siguientes,
 * con el tema (fm4) sonando desde el principio: sin él no hay referencia
 */
export function densestWindow(song: Song): Song {
  let best = 0
  let bestN = -1
  for (let i = 0; i < song.order.length; i++) {
    const n = song.tracks.filter((t) => hasNotes(song, t.id, i, 4)).length + (hasNotes(song, 'fm4', i, 1) ? 100 : 0)
    if (n > bestN) {
      best = i
      bestN = n
    }
  }
  return { ...song, order: song.order.slice(best), loopStart: -1 }
}

/** LUFS de una pista sola (o de varias) en los primeros `seconds` del tema */
export function tracksLufs(song: Song, sounding: number[], seconds: number, sr: number): number {
  const s: Song = structuredClone(song)
  s.tracks.forEach((t, i) => {
    t.mute = !sounding.includes(i)
    t.solo = false
  })
  const syn = new Synth(sr, s, 'md1')
  syn.stopAtEnd = true
  syn.play(0, 0)
  const n = Math.round(seconds * sr)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  syn.render(L, R, n)
  return integratedLufs(L, R, sr)
}

/** cada pista con notas del tramo más denso, medida sola frente al tema */
export function measureRoles(generator: string, song: Song, seconds = 30, sr = 22050): RoleReading[] {
  const w = densestWindow(song)
  const leadIdx = w.tracks.findIndex((t) => t.id === 'fm4')
  const lead = tracksLufs(w, [leadIdx], seconds, sr)
  if (!Number.isFinite(lead)) return []
  const out: RoleReading[] = []
  w.tracks.forEach((t, i) => {
    if (i === leadIdx || !hasNotes(w, t.id, 0, w.order.length)) return
    const l = tracksLufs(w, [i], seconds, sr)
    if (!Number.isFinite(l) || l < -70) return
    out.push({ key: trimKey(w, t), id: t.id, role: roleOf(generator, t), rel: l - lead, vol: t.vol, lead: leadName(w) })
  })
  return out
}
