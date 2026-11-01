// ── Utilidades compartidas por los generadores de temas ──────────────────────
import { psgHzFromPeriod, psgPeriodFromHz } from '../core/chipmath'
import type { Note, Pan, Pattern, Song } from './song'
import { patternSteps } from './song'
import { chordNotes, scaleById, type ChordType, type ScaleId } from './theory'

// ── PRNG determinista (mulberry32) ──────────────────────────────────────────
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  weighted(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0)
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]
      if (r <= 0) return i
    }
    return weights.length - 1
  }
}

// ── índices de los bancos de fábrica (ver presets.ts; solo se AÑADE al final) ─
export const FM = {
  SUB: 0,
  SLAP: 1,
  GROWL: 2,
  PLUCK: 3,
  EPIANO: 4,
  RHODES: 5,
  MALLET: 6,
  BELL: 7,
  SAW: 8,
  SQUARE: 9,
  BRASS: 10,
  FLUTE: 11,
  STRINGS: 12,
  CHOIR: 13,
  KICK: 14,
  ORGAN: 15,
  SEQ_BASS: 16,
  SOLINA: 17,
  COSMIC_LEAD: 18,
  TECHNO_BELL: 19,
  STAB: 20,
  ACID: 21,
  REESE: 22,
  DARK_PAD: 23,
  THEREMIN: 24,
  SAX: 25,
  JAZZ_GUITAR: 26,
  WALK_BASS: 27,
  VIBES: 28,
} as const
export const PSG = { LEAD: 0, PLUCK: 1, PAD: 2, STAB: 3, ARP: 4, BASS: 5, ECHO: 6, SWELL: 7, LASER: 8, BLIP: 9, TWINKLE: 10, PLUCK_HI: 11 } as const
export const DR = { KICK: 0, SNARE: 1, HAT: 2, OPEN: 3, CLAP: 4, TOM_LO: 5, TOM_HI: 6, RIM: 7 } as const
export const NZ = { HAT: 0, OPEN: 1, SNARE: 2, LOSNARE: 3, BUZZ: 4, RUMBLE: 5 } as const

export type FillKind = 'bass' | 'chords' | 'arp' | 'lead' | 'drums' | 'perc'

// ── rejillas de batería ─────────────────────────────────────────────────────
/** "X.x.|o..." → pasos con velocidad (X=15, x=10, o=6) */
export function grid(spec: string): { step: number; vel: number }[] {
  const out: { step: number; vel: number }[] = []
  let s = 0
  for (const ch of spec) {
    if (ch === '|' || ch === ' ') continue
    if (ch === 'X') out.push({ step: s, vel: 15 })
    else if (ch === 'x') out.push({ step: s, vel: 10 })
    else if (ch === 'o') out.push({ step: s, vel: 6 })
    s++
  }
  return out
}

export const v127 = (v: number): number => Math.max(1, Math.min(15, Math.round((v / 127) * 15)))

// ── contexto de generación ──────────────────────────────────────────────────
export interface BarChord {
  /** semitonos desde la tónica */
  root: number
  type: ChordType
  /** bajo distinto de la fundamental (acordes con inversión tipo Db/C) */
  bass?: number
}

export interface Ctx {
  rng: Rng
  song: Song
  key: number
  scale: ScaleId
  spb: number
  /** transposición (semitonos) que lleva el material escrito en Do a la tónica elegida */
  tr: number
  /** progresión: un acorde por compás (se cicla) */
  prog: BarChord[]
}

export type NoteRec = Record<string, Note[]>

/** articulación opcional de una nota: ligada a la anterior y/o con panorama propio */
export interface NoteArt {
  slide?: boolean
  pan?: Pan
}

export const put = (rec: NoteRec, track: string, step: number, len: number, note: number, vel: number, art?: NoteArt): void => {
  const n: Note = { step, len: Math.max(1, len), note: Math.max(0, Math.min(127, note)), vel: Math.max(1, Math.min(15, vel)) }
  if (art?.slide) n.slide = true
  if (art?.pan) n.pan = art.pan
  ;(rec[track] ??= []).push(n)
}

// ── afinación del PSG ───────────────────────────────────────────────────────
/**
 * Cents que desafina el SN76489 al tocar una nota: su periodo es un entero de 10 bits y en el
 * registro agudo los saltos entre periodos son mayores que un semitono afinado. Por debajo de
 * La2 el driver pliega la nota una octava arriba.
 */
export function psgCents(midi: number): number {
  let hz = 440 * Math.pow(2, (midi - 69) / 12)
  while (hz < 111) hz *= 2
  return 1200 * Math.log2(psgHzFromPeriod(psgPeriodFromHz(hz)) / hz)
}
/** desafinación que ya se oye contra el FM */
export const PSG_MAX_CENTS = 7
/** la misma nota en la octava más aguda en la que el PSG la da afinada */
export function psgInTune(midi: number): number {
  let n = midi
  while (n > 60 && Math.abs(psgCents(n)) > PSG_MAX_CENTS) n -= 12
  return n
}

/** lleva una tónica 0-11 a un registro cómodo: 7-11 se pasan a la octava inferior */
export const keyShift = (key: number): number => (key > 6 ? key - 12 : key)

export interface Cell {
  s: number
  l: number
  p: number
  v?: number
}

export const barStart = (ctx: { spb: number }, bar: number): number => bar * ctx.spb

export function putCells(rec: NoteRec, track: string, cells: Cell[], at: number, transpose: number, vel?: number): void {
  for (const c of cells) {
    const v = c.v !== undefined ? v127(c.v) : vel ?? 12
    put(rec, track, at + c.s, c.l, c.p + transpose, v)
  }
}

/** "0:2,3:1,6:2" → paso:longitud */
export const cellsOf = (spec: string, p = 0, lenDefault = 1): Cell[] =>
  spec.split(',').map((x) => {
    const [s, l] = x.split(':').map(Number)
    return { s, l: l || lenDefault, p }
  })

/** acorde diatónico (en pitch classes relativos a la tónica) para un grado de la escala */
export function chordForDegree(scale: ScaleId, degree: number, type: ChordType): BarChord {
  const steps = scaleById(scale).steps
  const len = steps.length
  const root = steps[((degree % len) + len) % len] + 12 * Math.floor(degree / len)
  return { root: root % 12, type }
}

/** notas (MIDI) del acorde en torno a `base`, con la fundamental ≥ base */
export function voiceChord(tonicMidi: number, c: BarChord, base: number): number[] {
  let root = tonicMidi + c.root
  while (root < base) root += 12
  while (root >= base + 12) root -= 12
  return chordNotes(root, c.type)
}

// ── ensamblado ──────────────────────────────────────────────────────────────
export function setInstruments(song: Song, map: Partial<Record<string, number>>): void {
  for (const t of song.tracks) {
    const i = map[t.id]
    if (i !== undefined) t.inst = i
  }
}

/** vuelca las notas generadas en el patrón: dentro de rango, recortadas y ordenadas */
export function applyNotes(song: Song, pat: Pattern, rec: NoteRec): void {
  const max = patternSteps(song, pat)
  for (const k of Object.keys(pat.notes)) pat.notes[k] = []
  for (const [track, arr] of Object.entries(rec)) {
    const tr = song.tracks.find((t) => t.id === track)
    pat.notes[track] = arr
      .filter((n) => n.step >= 0 && n.step < max)
      .map((n) => ({ ...n, len: Math.max(1, Math.min(n.len, max - n.step)) }))
      .sort((a, b) => a.step - b.step || a.note - b.note)
    if (tr?.kind === 'psg') tunePsg(pat.notes[track], tr.transpose)
  }
}

/** baja de octava, en el sitio, las notas que el PSG daría desafinadas */
export function tunePsg(notes: Note[], transpose = 0): void {
  for (const n of notes) n.note = psgInTune(n.note + transpose) - transpose
}
