// ── Operaciones de edición sobre la canción ─────────────────────────────────
//
// Todas mutan el `Song` recibido: están pensadas para usarse dentro de un
// `produce()` de immer (o sobre una copia). Mantienen invariantes: notas
// ordenadas, dentro del patrón y sin solaparse en la misma altura.
import {
  MAX_BARS,
  MAX_ORDER,
  MAX_PATTERNS,
  emptyPattern,
  getPattern,
  patternSteps,
  type Note,
  type Pattern,
  type Song,
} from './song'

const byStep = (a: Note, b: Note): number => a.step - b.step || a.note - b.note

export function patternOf(song: Song, patId: string): Pattern {
  const p = getPattern(song, patId)
  if (!p) throw new Error(`patrón inexistente: ${patId}`)
  return p
}

function trackNotes(song: Song, patId: string, trackId: string): Note[] {
  const p = patternOf(song, patId)
  if (!p.notes[trackId]) p.notes[trackId] = []
  return p.notes[trackId]
}

/** índice de la nota que cubre (step, note) o -1 */
export function findNoteAt(notes: readonly Note[], step: number, note: number): number {
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (n.note === note && step >= n.step && step < n.step + n.len) return i
  }
  return -1
}

/**
 * Inserta una nota. Si ya hay otra de la misma altura que se solapa, la
 * recorta/elimina para que no haya dos notas pisándose.
 */
export function addNote(song: Song, patId: string, trackId: string, n: Note, allowOverlapDifferentPitch = true): void {
  const p = patternOf(song, patId)
  const max = patternSteps(song, p)
  if (n.step < 0 || n.step >= max) return
  const len = Math.max(1, Math.min(n.len, max - n.step))
  const arr = trackNotes(song, patId, trackId)
  const end = n.step + len
  for (let i = arr.length - 1; i >= 0; i--) {
    const o = arr[i]
    if (o.note !== n.note && allowOverlapDifferentPitch) continue
    const oEnd = o.step + o.len
    if (o.step < end && oEnd > n.step) {
      if (o.step < n.step) o.len = n.step - o.step
      else arr.splice(i, 1)
    }
  }
  // se conservan la ligadura y el panorama propios de la nota
  arr.push({ ...n, len })
  arr.sort(byStep)
}

export function removeNote(song: Song, patId: string, trackId: string, index: number): void {
  const arr = trackNotes(song, patId, trackId)
  if (index >= 0 && index < arr.length) arr.splice(index, 1)
}

/** sustituye las notas de una pista (p. ej. tras mover/pegar varias) */
export function setTrackNotes(song: Song, patId: string, trackId: string, notes: Note[]): void {
  const p = patternOf(song, patId)
  const max = patternSteps(song, p)
  const clean: Note[] = []
  for (const n of notes) {
    if (n.step < 0 || n.step >= max || n.note < 0 || n.note > 127) continue
    clean.push({ ...n, len: Math.max(1, Math.min(n.len, max - n.step)), vel: Math.max(1, Math.min(15, n.vel)) })
  }
  clean.sort(byStep)
  p.notes[trackId] = clean
}

export function clearTrack(song: Song, patId: string, trackId: string): void {
  patternOf(song, patId).notes[trackId] = []
}

export function clearPattern(song: Song, patId: string): void {
  const p = patternOf(song, patId)
  for (const t of song.tracks) p.notes[t.id] = []
}

/** Cambia la longitud en compases; las notas fuera de rango se descartan (o se repiten al ampliar). */
export function setPatternBars(song: Song, patId: string, bars: number, repeat = false): void {
  const p = patternOf(song, patId)
  const nb = Math.max(1, Math.min(MAX_BARS, Math.round(bars)))
  const spb = song.beatsPerBar * 4
  const oldSteps = p.bars * spb
  const newSteps = nb * spb
  p.bars = nb
  for (const t of song.tracks) {
    const arr = p.notes[t.id] ?? []
    let out: Note[] = arr.filter((n) => n.step < newSteps).map((n) => ({ ...n, len: Math.min(n.len, newSteps - n.step) }))
    if (repeat && newSteps > oldSteps && arr.length) {
      for (let off = oldSteps; off < newSteps; off += oldSteps) {
        for (const n of arr) {
          const s = n.step + off
          if (s < newSteps) out.push({ ...n, step: s, len: Math.min(n.len, newSteps - s) })
        }
      }
    }
    out = out.sort(byStep)
    p.notes[t.id] = out
  }
}

export function addPattern(song: Song, bars = 4, name?: string): string {
  if (song.patterns.length >= MAX_PATTERNS) throw new Error('máximo de patrones alcanzado')
  const p = emptyPattern(song, bars, name)
  song.patterns.push(p)
  return p.id
}

export function duplicatePattern(song: Song, patId: string): string {
  if (song.patterns.length >= MAX_PATTERNS) throw new Error('máximo de patrones alcanzado')
  const src = patternOf(song, patId)
  const copy = emptyPattern(song, src.bars)
  for (const t of song.tracks) copy.notes[t.id] = (src.notes[t.id] ?? []).map((n) => ({ ...n }))
  song.patterns.push(copy)
  return copy.id
}

export function deletePattern(song: Song, patId: string): void {
  if (song.patterns.length <= 1) return
  song.patterns = song.patterns.filter((p) => p.id !== patId)
  song.order = song.order.filter((id) => id !== patId)
  if (song.order.length === 0) song.order = [song.patterns[0].id]
  if (song.loopStart >= song.order.length) song.loopStart = 0
}

export function renamePattern(song: Song, patId: string, name: string): void {
  patternOf(song, patId).name = name.slice(0, 8)
}

// ── orden / arreglo ─────────────────────────────────────────────────────────
export function insertOrder(song: Song, patId: string, at?: number): void {
  if (song.order.length >= MAX_ORDER) return
  const i = at === undefined ? song.order.length : Math.max(0, Math.min(at, song.order.length))
  song.order.splice(i, 0, patId)
  if (song.loopStart >= i && song.loopStart >= 0) song.loopStart++
}

export function removeOrder(song: Song, index: number): void {
  if (song.order.length <= 1) return
  song.order.splice(index, 1)
  if (song.loopStart > index) song.loopStart--
  if (song.loopStart >= song.order.length) song.loopStart = song.order.length - 1
}

export function moveOrder(song: Song, from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= song.order.length || to >= song.order.length) return
  const [id] = song.order.splice(from, 1)
  song.order.splice(to, 0, id)
}

// ── transformaciones ────────────────────────────────────────────────────────
export function transposeNotes(song: Song, patId: string, trackId: string, indices: number[], semis: number): void {
  const arr = trackNotes(song, patId, trackId)
  for (const i of indices) {
    const n = arr[i]
    if (n) n.note = Math.max(0, Math.min(127, n.note + semis))
  }
}

export function copyPatternTrack(song: Song, fromPat: string, trackId: string, toPat: string, toTrackId = trackId): void {
  const src = patternOf(song, fromPat).notes[trackId] ?? []
  const dst = patternOf(song, toPat)
  const max = patternSteps(song, dst)
  dst.notes[toTrackId] = src.filter((n) => n.step < max).map((n) => ({ ...n, len: Math.min(n.len, max - n.step) }))
}

/** cuantiza al `grid` de pasos más cercano */
export function quantizeNotes(song: Song, patId: string, trackId: string, grid: number): void {
  const p = patternOf(song, patId)
  const max = patternSteps(song, p)
  const arr = trackNotes(song, patId, trackId)
  for (const n of arr) {
    n.step = Math.min(max - 1, Math.round(n.step / grid) * grid)
    n.len = Math.max(1, Math.round(n.len / grid) * grid || 1)
    if (n.step + n.len > max) n.len = max - n.step
  }
  arr.sort(byStep)
}

export function countNotes(song: Song): number {
  let c = 0
  for (const p of song.patterns) for (const t of song.tracks) c += p.notes[t.id]?.length ?? 0
  return c
}
