// ── Capas: un tema generado entra por partes ────────────────────────────────
// Al generar suenan primero las pistas que sostienen el tema (batería, bajo, tema y la armonía principal) y
// el resto espera en mute. Cada SIGUIENTE suma una pista, en el orden en que se monta un arreglo, así que se
// puede dar por buena la base antes de oír todo junto. Todo se guarda como mute de pista: lo deshace Ctrl+Z,
// lo respeta la exportación y los botones M de los canales siguen mandando.
import type { Song } from './song'

/**
 * orden de entrada de las pistas: ritmo, bajo, tema, armonía principal, el resto de la armonía (o la segunda
 * voz), la percusión de ruido y los colores del PSG. Es la convención de todos los estilos y piezas.
 */
export const REVEAL_ORDER = ['ch6', 'fm1', 'fm4', 'fm2', 'fm3', 'fm5', 'noise', 'sq1', 'sq2', 'sq3']

/** pistas que suenan nada más generar */
export const FIRST_LAYER = 4

const hasNotes = (song: Song, id: string): boolean => song.patterns.some((p) => (p.notes[id]?.length ?? 0) > 0)

const rank = (id: string): number => {
  const r = REVEAL_ORDER.indexOf(id)
  return r < 0 ? REVEAL_ORDER.length : r
}

/** índices de las pistas que tienen notas, en orden de entrada */
export function revealOrder(song: Song): number[] {
  return song.tracks
    .map((t, i) => ({ id: t.id, i }))
    .filter(({ id }) => hasNotes(song, id))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
    .map(({ i }) => i)
}

/** deja sonar solo las primeras `first` pistas y pone las demás en espera (cambia `song`) */
export function startLayers(song: Song, first = FIRST_LAYER): number[] {
  const order = revealOrder(song)
  order.forEach((i, k) => {
    song.tracks[i].mute = k >= first
    song.tracks[i].solo = false
  })
  return order.slice(0, first)
}

export interface LayerState {
  /** pistas con notas que suenan */
  sounding: number
  /** pistas con notas */
  total: number
  /** la próxima pista en espera (índice), o null si ya suenan todas */
  next: number | null
}

export function layerState(song: Song): LayerState {
  const order = revealOrder(song)
  const waiting = order.filter((i) => song.tracks[i].mute)
  return { sounding: order.length - waiting.length, total: order.length, next: waiting[0] ?? null }
}

/** suma la siguiente pista en espera (cambia `song`); devuelve su índice o null si no quedaba ninguna */
export function revealNext(song: Song): number | null {
  const { next } = layerState(song)
  if (next !== null) song.tracks[next].mute = false
  return next
}

/** todas las pistas con notas suenan (cambia `song`) */
export function revealAll(song: Song): void {
  for (const i of revealOrder(song)) song.tracks[i].mute = false
}

/** "A, B, C y D" */
export function listNames(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/**
 * Deja sonar la primera capa de un tema recién generado y devuelve el trozo de aviso que lo cuenta
 * (" · suenan A, B, C y D; + SIGUIENTE suma las otras 6"), o '' si no queda nada en espera.
 */
export function layerIntro(song: Song): string {
  const first = startLayers(song)
  const waiting = layerState(song).total - first.length
  if (waiting <= 0) return ''
  const rest = waiting === 1 ? 'la otra' : `las otras ${waiting}`
  return ` · suenan ${listNames(first.map((i) => song.tracks[i].name))}; + SIGUIENTE suma ${rest}`
}
