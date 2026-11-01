// ── Qué se exporta: la canción, el patrón seleccionado o cada patrón por separado ──
//
// Quien compone patrón a patrón (silenciando pistas para oír una sola capa) necesita sacar un patrón
// suelto, no la canción entera. Un patrón se exporta como una canción de un solo bloque que se repite:
// WAV/stems lo tocan las vueltas pedidas, VGM/XGM/ROM lo dejan en bucle y MIDI lo escribe una vez.
// MUTE y SOLO cuentan como en la reproducción (los exportadores que pasan por el motor los respetan).
import type { Song } from '../music/song'

export type ExportScope = 'song' | 'pattern' | 'patterns'

/** nombre de archivo seguro: sin acentos ni símbolos, con guiones bajos */
export const slug = (s: string, max = 40): string =>
  (s || 'tzootz')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'tzootz'

/** la canción con un único patrón, en bucle (la original no se toca) */
export function patternSong(song: Song, patternId: string): Song {
  const p = song.patterns.find((x) => x.id === patternId) ?? song.patterns[0]
  return {
    ...song,
    title: `${song.title} · ${p.name}`.slice(0, 40),
    patterns: [p],
    order: [p.id],
    loopStart: 0,
  }
}

const hasNotes = (song: Song, id: string): boolean => {
  const p = song.patterns.find((x) => x.id === id)
  return p !== undefined && Object.values(p.notes).some((n) => n.length > 0)
}

export interface ExportPart {
  /** nombre del patrón ('' = la canción entera) */
  label: string
  song: Song
}

/** lo que se va a exportar: una canción, un patrón o todos los patrones con notas (si ninguno tiene, todos) */
export function exportParts(song: Song, scope: ExportScope, selPattern: string): ExportPart[] {
  if (scope === 'song') return [{ label: '', song }]
  if (scope === 'pattern') {
    const p = song.patterns.find((x) => x.id === selPattern) ?? song.patterns[0]
    return [{ label: p.name, song: patternSong(song, p.id) }]
  }
  const withNotes = song.patterns.filter((p) => hasNotes(song, p.id))
  return (withNotes.length ? withNotes : song.patterns).map((p) => ({ label: p.name, song: patternSong(song, p.id) }))
}

/** nombre del archivo de una parte: título, número (si son varias) y patrón; sin choques entre patrones de nombre parecido */
export function partFileName(title: string, label: string, index: number, total: number, ext: string): string {
  const base = slug(title, 24)
  const num = total > 1 ? `_${String(index + 1).padStart(2, '0')}` : ''
  return `${base}${num}_${slug(label, 16)}${ext}`
}

/** formatos que admiten cada alcance: una ROM por patrón sería un cartucho por patrón */
export const SCOPE_KINDS: Record<ExportScope, readonly string[]> = {
  song: ['wav', 'stems', 'midi', 'vgm', 'vgz', 'xgm', 'rom', 'project'],
  pattern: ['wav', 'stems', 'midi', 'vgm', 'vgz', 'xgm', 'rom', 'project'],
  patterns: ['wav', 'stems', 'midi', 'vgm', 'vgz', 'xgm'],
}
