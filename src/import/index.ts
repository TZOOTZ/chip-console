// ── Importar cualquier archivo que la app entiende: proyecto, MIDI o VGM/VGZ ──────
import { songFromProjectFile } from '../export/share'
import type { Song } from '../music/song'
import { songFromMidi, type ImportReport } from './midi'
import { songFromVgm } from './vgm'

export type ImportKind = 'proyecto' | 'MIDI' | 'VGM'

export interface Imported {
  kind: ImportKind
  song: Song
  /** solo en MIDI y VGM: lo que ha entrado, lo que no y lo que se ha medido */
  report?: ImportReport
}

const tag = (b: Uint8Array, s: string): boolean => b.length >= s.length && [...s].every((c, i) => b[i] === c.charCodeAt(0))

/** Reconoce el archivo por su contenido (no por la extensión) y lo convierte en una canción. */
export function importSong(bytes: Uint8Array, fileName = ''): Imported {
  if (tag(bytes, 'MThd')) {
    const r = songFromMidi(bytes, fileName)
    return { kind: 'MIDI', song: r.song, report: r.report }
  }
  // un .vgz es un VGM comprimido con gzip
  if (tag(bytes, 'Vgm ') || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    const r = songFromVgm(bytes, fileName)
    return { kind: 'VGM', song: r.song, report: r.report }
  }
  return { kind: 'proyecto', song: songFromProjectFile(new TextDecoder().decode(bytes)) }
}
