// ── Persistencia local: autoguardado y biblioteca de proyectos ──────────────
import { packSong, unpackSong } from '../export/share'
import type { Song } from '../music/song'

const AUTOSAVE_KEY = 'tz-megadrive:autosave'
const LIB_KEY = 'tz-megadrive:library'

export interface LibraryEntry {
  id: string
  name: string
  updated: number
  data: unknown
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function saveAutosave(song: Song): boolean {
  return write(AUTOSAVE_KEY, { at: Date.now(), data: packSong(song) })
}

export function loadAutosave(): Song | null {
  const r = read<{ at: number; data: unknown }>(AUTOSAVE_KEY)
  if (!r) return null
  try {
    return unpackSong(r.data)
  } catch {
    return null
  }
}

export function listLibrary(): LibraryEntry[] {
  const lib = read<LibraryEntry[]>(LIB_KEY)
  return Array.isArray(lib) ? lib.sort((a, b) => b.updated - a.updated) : []
}

export function saveToLibrary(song: Song, id?: string): LibraryEntry {
  const lib = listLibrary()
  const entryId = id ?? `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
  const entry: LibraryEntry = { id: entryId, name: song.title || 'SIN TÍTULO', updated: Date.now(), data: packSong(song) }
  const next = [entry, ...lib.filter((e) => e.id !== entryId)].slice(0, 60)
  write(LIB_KEY, next)
  return entry
}

export function loadFromLibrary(id: string): Song | null {
  const e = listLibrary().find((x) => x.id === id)
  if (!e) return null
  try {
    return unpackSong(e.data)
  } catch {
    return null
  }
}

export function deleteFromLibrary(id: string): void {
  write(
    LIB_KEY,
    listLibrary().filter((e) => e.id !== id),
  )
}
