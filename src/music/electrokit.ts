// ── Base común de los estilos electrónicos (COSMIC DISCO · TECHNO MINIMAL · DARK) ─
//
// Armonía por compases, pistas y secciones, bajo por patrones, acordes a tres
// voces reales (una nota por canal FM), arpegios con eco, melodía por motivos y
// utilidades de percusión.
import { NZ, applyNotes, keyShift, put, type NoteRec, type Rng } from './genkit'
import type { DrumVoice, Note, Song, Track } from './song'
import { emptyPattern } from './song'
import { chordById, scaleById, type ChordType, type ScaleId } from './theory'

export interface Harm {
  /** semitonos sobre la tónica (0-11) */
  root: number
  type: ChordType
}
export const h = (root: number, type: ChordType): Harm => ({ root, type })

export interface Env {
  rng: Rng
  song: Song
  spb: number
  /** tónica como pitch class */
  key: number
  /** tónica en el registro de bajo (Sol1–Fa#2) y alrededor de Do4 */
  bassTonic: number
  midTonic: number
  /** pitch classes de la escala, relativos a la tónica */
  scale: number[]
}

export function makeEnv(song: Song, rng: Rng): Env {
  const sh = keyShift(song.key)
  return { rng, song, spb: song.beatsPerBar * 4, key: song.key, bassTonic: 36 + sh, midTonic: 60 + sh, scale: scaleById(song.scale).steps }
}

export function setScale(env: Env, id: ScaleId): void {
  env.song.scale = id
  env.scale = scaleById(id).steps
}

export const X = null
export const mod12 = (n: number): number => ((n % 12) + 12) % 12
export const relPc = (env: Env, midi: number): number => mod12(midi - env.key)
export const chordPcs = (c: Harm): number[] => chordById(c.type).intervals.map((i) => mod12(c.root + i))
export const sameChord = (a: Harm, b: Harm): boolean => a.root === b.root && a.type === b.type

/** notas MIDI de la escala dentro de [lo, hi] */
export function ladder(env: Env, lo: number, hi: number): number[] {
  const out: number[] = []
  for (let m = lo; m <= hi; m++) if (env.scale.includes(relPc(env, m))) out.push(m)
  return out
}

// ── pistas, kit y secciones ─────────────────────────────────────────────────
export interface TrackSetup {
  inst?: number
  name?: string
  vol?: number
  pan?: Track['pan']
  gate?: number
  /** frames de portamento de las notas ligadas */
  glide?: number
}

export function setupTracks(song: Song, map: Record<string, TrackSetup>): void {
  for (const t of song.tracks) {
    const s = map[t.id]
    if (!s) continue
    if (s.inst !== undefined) t.inst = s.inst
    if (s.name !== undefined) t.name = s.name
    if (s.vol !== undefined) t.vol = s.vol
    if (s.pan !== undefined) t.pan = s.pan
    if (s.gate !== undefined) t.gate = s.gate
    if (s.glide !== undefined) t.glide = s.glide
  }
}

export const dv = (name: string, kind: DrumVoice['kind'], pitch: number, decay: number, tone: number, gain: number): DrumVoice => ({ name, kind, pitch, decay, tone, gain })

export function addSection(song: Song, name: string, bars: number, repeat: number, build: (rec: NoteRec) => void): void {
  const pat = emptyPattern(song, bars, name)
  const rec: NoteRec = {}
  build(rec)
  applyNotes(song, pat, rec)
  song.patterns.push(pat)
  for (let r = 0; r < repeat; r++) song.order.push(pat.id)
}

/** copia en `rec` las notas de `src` (material compuesto una vez y reutilizado en varias secciones) */
export function merge(rec: NoteRec, src: NoteRec, velDelta = 0): void {
  for (const [track, arr] of Object.entries(src)) for (const n of arr) put(rec, track, n.step, n.len, n.note, n.vel + velDelta, n)
}

/**
 * Fraseo ligado, en el sitio: toda nota pegada a la anterior y de otra altura se liga (sin
 * re-ataque, con el portamento de la pista). Se vuelve a atacar al empezar cada frase de
 * `phrase` pasos, tras un silencio y en las notas repetidas, que si no se fundirían en una.
 */
export function legato(notes: Note[], phrase: number): void {
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1]
    const b = notes[i]
    if (a.step + a.len === b.step && a.note !== b.note && b.step % phrase !== 0) b.slide = true
  }
}

// ── bajo ────────────────────────────────────────────────────────────────────
/** fundamental del acorde en el registro de bajo (Mi1–Do3) */
export function bassRoot(env: Env, c: Harm): number {
  let n = env.bassTonic + c.root
  if (n > env.bassTonic + 6) n -= 12
  if (n < 28) n += 12
  return n
}

/**
 * Patrón de bajo de un compás: semitonos sobre la fundamental por semicorchea
 * (X = silencio). Comodines: 96 = tercera menor o quinta · 97 = segunda menor
 * frigia (solo sobre la tónica) u octava · 98 = séptima menor u octava ·
 * 99 = fundamental del compás siguiente.
 */
export interface BassPat {
  len: number
  steps: (number | null)[]
  /** duración propia de algún paso (si falta, vale `len`) */
  lens?: number[]
  /** pasos ligados a la nota anterior: sin re-ataque y con el portamento de la pista (el "slide" de una 303) */
  slides?: number[]
}

export function bassNote(env: Env, c: Harm, next: Harm, off: number): number {
  const root = bassRoot(env, c)
  const iv = chordById(c.type).intervals
  switch (off) {
    case 99:
      return bassRoot(env, next)
    case 98:
      return root + (iv.includes(10) ? 10 : 12)
    case 97:
      return root + (c.root === 0 && env.scale.includes(1) ? 1 : 12)
    case 96:
      return root + (iv.includes(3) ? 3 : 7)
    default:
      // la quinta de un acorde disminuido es la suya, no la justa
      return root + (off === 7 && iv.includes(6) && !iv.includes(7) ? 6 : off)
  }
}

export function writeBass(env: Env, rec: NoteRec, track: string, prog: Harm[], bars: number, pat: BassPat, o: { vel?: number; from?: number; to?: number } = {}): void {
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const c = prog[b % prog.length]
    const next = prog[(b + 1) % prog.length]
    const at = b * env.spb
    pat.steps.forEach((off, s) => {
      if (off === null || s >= env.spb) return
      const acc = s % 4 === 0 ? 2 : s % 4 === 2 ? 0 : -2
      put(rec, track, at + s, pat.lens?.[s] ?? pat.len, bassNote(env, c, next, off), (o.vel ?? 12) + acc, { slide: pat.slides?.includes(s) })
    })
  }
}

// ── acordes a tres voces ────────────────────────────────────────────────────
export const PAD_TRACKS = ['fm2', 'fm3', 'fm5']

/** tres notas del acorde: la disposición más cercana a la anterior (conducción de voces suave) */
export function padVoices(env: Env, prev: number[] | null, c: Harm, lo: number, hi: number): number[] {
  const iv = chordById(c.type).intervals
  // con séptima o novena se omite la fundamental: ya la toca el bajo
  const pick = iv.length >= 5 ? [iv[1], iv[3], iv[4]] : iv.length === 4 ? [iv[1], iv[2], iv[3]] : iv
  const pcs = pick.map((i) => mod12(c.root + i))
  const options = pcs.map((pc) => {
    const out: number[] = []
    for (let m = lo; m <= hi; m++) if (relPc(env, m) === pc) out.push(m)
    return out
  })
  let best: number[] | null = null
  let bestCost = Infinity
  for (const a of options[0] ?? []) {
    for (const b of options[1] ?? []) {
      for (const d of options[2] ?? []) {
        const v = [a, b, d].sort((x, y) => x - y)
        if (v[0] === v[1] || v[1] === v[2]) continue
        const span = v[2] - v[0]
        let cost = span > 14 ? (span - 14) * 3 : 0
        if (prev) cost += Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2])
        else cost += Math.abs((v[0] + v[1] + v[2]) / 3 - (lo + hi) / 2)
        if (cost < bestCost) {
          bestCost = cost
          best = v
        }
      }
    }
  }
  return best ?? [env.midTonic, env.midTonic + 3, env.midTonic + 7]
}

export interface PadOpts {
  vel: number
  lo?: number
  hi?: number
  from?: number
  to?: number
}

/** un acorde por compás repartido en fm2 / fm3 / fm5; los compases con el mismo acorde se ligan */
export function writePads(env: Env, rec: NoteRec, prog: Harm[], bars: number, o: PadOpts): void {
  let prev: number[] | null = null
  let prevChord: Harm | null = null
  const last: (Note | null)[] = [null, null, null]
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const c = prog[b % prog.length]
    if (prevChord && sameChord(prevChord, c) && last[0]) {
      for (const n of last) if (n) n.len += env.spb
      continue
    }
    const v = padVoices(env, prev, c, o.lo ?? 52, o.hi ?? 74)
    v.forEach((note, i) => {
      put(rec, PAD_TRACKS[i], b * env.spb, env.spb, note, o.vel)
      const arr = rec[PAD_TRACKS[i]]
      last[i] = arr[arr.length - 1]
    })
    prev = v
    prevChord = c
  }
}

// ── arpegios y eco ──────────────────────────────────────────────────────────
/** notas del acorde en orden ascendente desde `base` (unas dos octavas) */
export function chordSeries(env: Env, c: Harm, base: number): number[] {
  const pcs = chordPcs(c).slice(0, 4)
  const out: number[] = []
  for (let m = base; m < base + 26 && out.length < 8; m++) if (pcs.includes(relPc(env, m))) out.push(m)
  return out
}

/** formas de arpegio: índices sobre la serie de notas del acorde */
export const ARP_SHAPES: number[][] = [
  [0, 1, 2, 3],
  [0, 1, 2, 3, 2, 1],
  [3, 0, 3, 1, 3, 2, 3, 1],
  [0, 2, 1, 3],
  [0, 2, 4, 2, 1, 3, 5, 3],
  [0, 1, 2, 0, 1, 2, 3, 2],
  [0, 3, 2, 3, 1, 3, 2, 3],
]

export interface ArpOpts {
  shape: number[]
  rate: 1 | 2
  base: number
  vel: number
  from?: number
  to?: number
}

export function writeArp(env: Env, rec: NoteRec, track: string, prog: Harm[], bars: number, o: ArpOpts): void {
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const ser = chordSeries(env, prog[b % prog.length], o.base)
    if (ser.length === 0) continue
    const at = b * env.spb
    for (let s = 0, k = 0; s < env.spb; s += o.rate, k++) {
      const note = ser[o.shape[k % o.shape.length] % ser.length]
      put(rec, track, at + s, o.rate, note, o.vel + (s % 4 === 0 ? 2 : s % 2 === 0 ? 0 : -2))
    }
  }
}

/** eco: copia retrasada y más suave de una pista en otra (lo que se sale del patrón se descarta) */
export function writeEcho(rec: NoteRec, from: string, to: string, delay: number, vel: number, total: number, shift = 0): void {
  for (const n of rec[from] ?? []) {
    const s = n.step + delay
    if (s < total) put(rec, to, s, n.len, n.note + shift, vel)
  }
}

// ── melodía por motivos ─────────────────────────────────────────────────────
export interface Motif {
  rhythm: [number, number][]
  deltas: number[]
}

export interface MelodyCfg {
  track: string
  lo: number
  hi: number
  /** plantillas rítmicas de 2 compases: [paso, duración] */
  rhythms: [number, number][][]
  /** pesos de movimiento por la escala: [0, +1, -1, +2, -2, +3, -3, +4, -4] */
  moves: number[]
  vel: number
}

export const MOVES = [0, 1, -1, 2, -2, 3, -3, 4, -4]

/**
 * Melodía en frases de 8 compases con forma A · B · A' · C (unidades de 2 compases):
 * A' repite el contorno de A sobre los acordes nuevos y C descansa en la tónica o la quinta.
 * Las notas fuertes (inicio de compás, notas largas) caen siempre en notas del acorde.
 */
export function writeMelody(env: Env, rec: NoteRec, cfg: MelodyCfg, prog: Harm[], bars: number): void {
  const { rng, spb } = env
  const lad = ladder(env, cfg.lo, cfg.hi)
  if (lad.length < 5) return
  const nearest = (idx: number, ok: (j: number) => boolean): number => {
    for (let k = 0; k <= 5; k++) {
      // en empate, hacia el centro del registro
      const order = idx > lad.length / 2 ? [idx - k, idx + k] : [idx + k, idx - k]
      for (const j of order) if (j >= 0 && j < lad.length && ok(j)) return j
    }
    return idx
  }
  const snap = (idx: number, c: Harm): number => {
    const pcs = chordPcs(c)
    return nearest(idx, (j) => pcs.includes(relPc(env, lad[j])))
  }
  const newMotif = (): Motif => {
    const rhythm = rng.pick(cfg.rhythms)
    return { rhythm, deltas: rhythm.map((_, i) => (i === 0 ? 0 : MOVES[rng.weighted(cfg.moves)])) }
  }
  const units = Math.ceil(bars / 2)
  let a: Motif | null = null
  let idx = snap(Math.floor(lad.length * 0.55), prog[0])
  for (let u = 0; u < units; u++) {
    const pos = u % 4
    let m: Motif
    if (pos === 0 || !a) {
      a = newMotif()
      m = a
    } else if (pos === 2) {
      // misma célula, con el giro final cambiado de sentido
      const src: Motif = a
      m = { rhythm: src.rhythm, deltas: src.deltas.map((d, i) => (i >= src.deltas.length - 2 && rng.chance(0.5) ? -d : d)) }
    } else m = newMotif()
    const at = u * 2 * spb
    for (let i = 0; i < m.rhythm.length; i++) {
      const [s, l] = m.rhythm[i]
      const bar = u * 2 + Math.floor(s / spb)
      if (bar >= bars) break
      const c = prog[bar % prog.length]
      idx += m.deltas[i]
      // rebote en los límites del registro
      if (idx < 0) idx = -idx
      if (idx >= lad.length) idx = 2 * (lad.length - 1) - idx
      idx = Math.max(0, Math.min(lad.length - 1, idx))
      const strong = i === 0 || s % spb === 0 || l >= 6
      if (strong) idx = snap(idx, c)
      if (pos === 3 && i === m.rhythm.length - 1) {
        // final de frase: reposo en la tónica o la quinta si el acorde lo admite
        const pcs = chordPcs(c)
        const rest = [0, 7].filter((pc) => pcs.includes(pc))
        if (rest.length) idx = nearest(idx, (j) => rest.includes(relPc(env, lad[j])))
      }
      put(rec, cfg.track, at + s, l, lad[idx], strong ? cfg.vel : cfg.vel - 2)
    }
  }
}

// ── percusión ───────────────────────────────────────────────────────────────
export const hit = (rec: NoteRec, at: number, drum: number, vel: number): void => put(rec, 'ch6', at, 1, drum, vel)
export const hiss = (rec: NoteRec, at: number, voice: number, vel: number, len = 1): void => put(rec, 'noise', at, len, voice, vel)

/** redoble en semicorcheas con crescendo */
export function roll(rec: NoteRec, from: number, to: number, drum: number, v0: number, v1: number): void {
  const n = Math.max(1, to - from)
  for (let s = from; s < to; s++) hit(rec, s, drum, Math.round(v0 + ((v1 - v0) * (s - from)) / n))
}

/** subida de ruido: de grave a agudo y de suave a fuerte */
export function riser(rec: NoteRec, from: number, to: number, v0 = 3, v1 = 13): void {
  const n = Math.max(1, to - from)
  for (let s = from; s < to; s += 2) {
    const f = (s - from) / n
    hiss(rec, s, f < 0.34 ? NZ.LOSNARE : f < 0.67 ? NZ.SNARE : NZ.OPEN, Math.round(v0 + f * (v1 - v0)), 2)
  }
}
