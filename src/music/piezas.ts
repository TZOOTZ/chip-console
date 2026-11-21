// ── PIEZAS DE JUEGO: fanfarria, maestoso, bourrée, giga, zarabanda y agitato ─
//
// Las formas y los caracteres de siempre como piezas cortas de videojuego. Cada una tiene su
// compás, su tempo, su plantilla y su forma: la fanfarria es una llamada de cuatro compases que
// no vuelve a empezar; el maestoso, una introducción y un tema de dos frases; las danzas barrocas
// van en forma binaria (A A B B) y la repetición sale ornamentada; el agitato es un bucle de
// persecución.
//
// Las melodías están escritas a mano en grados de la escala (como las ideas de COSMIC): así la
// misma pieza suena en cualquier tonalidad y en mayor o en menor. En menor, la sensible se sube
// sola sobre la dominante y la sexta también cuando sube hacia ella (menor melódica). Los bajos
// de las danzas y del maestoso no están escritos: se buscan nota a nota con un contrapunto a dos
// voces contra la melodía (sin quintas ni octavas paralelas, consonancia en las partes fuertes,
// notas de paso solo por grados).
import { mordent } from './figuras'
import { applyMix } from './mezcla'
import { addSection, dv, makeEnv, padVoices, setupTracks, type Env, type Harm } from './electrokit'
import { FM, NZ, PSG, Rng, put, type NoteRec } from './genkit'
import { createEmptySong } from './presets'
import { timpPitch, type Note, type Song } from './song'
import type { ChordType } from './theory'

export type PieceId = 'fanfare' | 'maestoso' | 'bourree' | 'gigue' | 'sarabande' | 'agitato'
export type PieceMode = 'auto' | 'major' | 'minor'

export interface PieceInfo {
  id: PieceId
  name: string
  blurb: string
  /** negras por minuto */
  bpm: [number, number]
  /** tiempos de negra por compás (la giga escribe su 6/8 sobre la rejilla de 3/4) */
  beats: number
  /** compás que se muestra y tempo tal como lo diría un músico */
  meter: string
  tempo: string
}

export const PIECES: PieceInfo[] = [
  {
    id: 'fanfare',
    name: 'FANFARRIA',
    blurb: 'Llamada de metales para ganar, abrir un cofre o entrar en palacio: dos trompetas en terceras, trompas, tuba, timbales, redoble y plato. Cuatro compases y se para',
    bpm: [112, 132],
    beats: 4,
    meter: '4/4',
    tempo: '♩ = 112–132',
  },
  {
    id: 'maestoso',
    name: 'MAESTOSO',
    blurb: 'Pantalla de título o salón del trono: tema lento con puntillo en la trompeta, bajo que baja por grados, trompas y cuerdas, arpa y timbales. Entrada con redoble',
    bpm: [72, 86],
    beats: 4,
    meter: '4/4',
    tempo: '♩ = 72–86',
  },
  {
    id: 'bourree',
    name: 'BOURRÉE',
    blurb: 'Danza barroca ligera, a la breve y con anacrusa: oboe y clave a dos voces en contrapunto. La repetición sale ornamentada, con flauta y pandereta',
    bpm: [108, 124],
    beats: 4,
    meter: '2/2',
    tempo: '𝅗𝅥 = 54–62',
  },
  {
    id: 'gigue',
    name: 'GIGA',
    blurb: 'Danza rápida en 6/8 que entra en imitación: el bajo repite el sujeto y la segunda parte lo invierte. Barroca con clave, o de taberna con flauta, violín y bodhrán',
    bpm: [150, 168],
    beats: 3,
    meter: '6/8',
    tempo: '♩. = 100–112',
  },
  {
    id: 'sarabande',
    name: 'ZARABANDA',
    blurb: 'Lenta y grave en 3/4 con el peso en el segundo tiempo: violín, cuerdas u órgano y chelo, con retardo en la cadencia. Para la corte, la capilla o una despedida',
    bpm: [56, 66],
    beats: 3,
    meter: '3/4',
    tempo: '♩ = 56–66',
  },
  {
    id: 'agitato',
    name: 'AGITATO',
    blurb: 'Persecución o combate: trémolo de cuerdas, metales con síncopas, bajo en corcheas, golpes de trompa, timbales y una escala que sube al final de cada vuelta',
    bpm: [160, 176],
    beats: 4,
    meter: '4/4',
    tempo: '♩ = 160–176',
  },
]

// ═════════════════════════════════════════════════════════════════════════════
//  Notación: grados y acordes
// ═════════════════════════════════════════════════════════════════════════════
const MAJ = [0, 2, 4, 5, 7, 9, 11]
const NAT = [0, 2, 3, 5, 7, 8, 10]
const HARM = [0, 2, 3, 5, 7, 8, 11]
const mod7 = (n: number): number => ((n % 7) + 7) % 7
const mod12 = (n: number): number => ((n % 12) + 12) % 12

/** una nota escrita: grado (0 = tónica, 7 = su octava), alteración en semitonos y si se liga a la siguiente */
export interface PNote {
  step: number
  len: number
  deg: number
  acc: number
  rest: boolean
  tie: boolean
}

/**
 * "4.4 2.4 0.2 1.2 2.4 | 1.4 -1.4 0.8": grado.duración en semicorcheas, compases separados por
 * `|`. `#`/`b` tras el grado lo alteran, `r` es silencio y `~` al final liga con la nota siguiente.
 * Cada compás tiene que sumar exactamente `spb` pasos.
 */
export function parseLine(src: string, spb: number): PNote[] {
  const out: PNote[] = []
  const bars = src.split('|')
  bars.forEach((bar, b) => {
    let s = b * spb
    for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(r|-?\d+)([#b]?)\.(\d+)(~?)$/.exec(tok)
      if (!m) throw new Error(`nota mal escrita: ${tok}`)
      const len = Number(m[3])
      out.push({ step: s, len, deg: m[1] === 'r' ? 0 : Number(m[1]), acc: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, rest: m[1] === 'r', tie: m[4] === '~' })
      s += len
    }
    if (s !== (b + 1) * spb) throw new Error(`el compás ${b + 1} suma ${s - b * spb} pasos y no ${spb}: ${bar.trim()}`)
  })
  return out
}

/** acorde de la pieza: fundamental en semitonos sobre la tónica y si pide la sensible (dominante en menor) */
export interface PChord extends Harm {
  deg: number
  sym: string
  lead: boolean
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii']

export function chordOf(sym: string, minor: boolean): PChord {
  if (sym === 'V/V') return { sym, deg: 1, root: 2, type: 'maj', lead: false }
  const seventh = sym.endsWith('7')
  const name = sym.replace('7', '').replace('°', '').toLowerCase()
  const deg = ROMAN.indexOf(name)
  if (deg < 0) throw new Error(`acorde desconocido: ${sym}`)
  const lead = minor && (deg === 4 || deg === 6)
  const sc = minor ? (lead ? HARM : NAT) : MAJ
  const at = (k: number): number => sc[(deg + k) % 7] + (deg + k >= 7 ? 12 : 0) - sc[deg]
  const [t, f, sv] = [at(2), at(4), at(6)]
  let type: ChordType = 'maj'
  if (t === 3 && f === 7) type = seventh ? 'min7' : 'min'
  else if (t === 4 && f === 7) type = seventh ? (sv === 10 ? 'dom7' : 'maj7') : 'maj'
  else if (t === 3 && f === 6) type = seventh ? (sv === 10 ? 'm7b5' : 'dim7') : 'dim'
  else if (t === 4 && f === 8) type = 'aug'
  return { sym, deg, root: sc[deg], type, lead }
}

export const parseChords = (src: string, minor: boolean): PChord[] =>
  src
    .split(/[\s|]+/)
    .filter(Boolean)
    .map((s) => chordOf(s, minor))

const CHORD_IV: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
}
/** pitch classes del acorde relativas a la tónica */
export const pcsOf = (c: PChord): number[] => (CHORD_IV[c.type] ?? [0, 4, 7]).map((i) => mod12(c.root + i))

/** una voz ya en notas MIDI */
interface MNote {
  step: number
  len: number
  note: number
}

/** pasa una línea a MIDI sobre `base` (la tónica de su registro): sensible y sexta melódica en menor, ligaduras resueltas */
export function realize(line: PNote[], chordAt: (step: number) => PChord, base: number, minor: boolean): MNote[] {
  const notes = line.filter((n) => !n.rest)
  const pcOf = (n: PNote): number => {
    const c = chordAt(n.step)
    let pc = (minor ? NAT : MAJ)[mod7(n.deg)] + n.acc
    if (minor && n.acc === 0 && mod7(n.deg) === 6 && c.lead) pc += 1
    return pc
  }
  const pcs = notes.map(pcOf)
  if (minor) {
    // sexta → sensible subiendo: la sexta también sube (sin segunda aumentada)
    for (let i = 0; i + 1 < notes.length; i++) {
      const a = notes[i]
      const b = notes[i + 1]
      if (mod7(a.deg) === 5 && a.acc === 0 && pcs[i + 1] === 11 && b.deg === a.deg + 1) pcs[i] = 9
    }
  }
  const out: MNote[] = []
  notes.forEach((n, i) => {
    const note = base + pcs[i] + 12 * Math.floor(n.deg / 7)
    const prev = out[out.length - 1]
    const prevTied = i > 0 && notes[i - 1].tie && prev && prev.note === note && prev.step + prev.len === n.step
    if (prevTied) prev.len += n.len
    else out.push({ step: n.step, len: n.len, note })
  })
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
//  Contrapunto: el bajo nota a nota contra la melodía
// ═════════════════════════════════════════════════════════════════════════════
export interface Slot {
  step: number
  len: number
  c: PChord
  /** primera nota del acorde: va la fundamental (o, si acaso, la tercera) */
  first: boolean
  /** parte fuerte: nada de notas de paso ni disonancias */
  strong: boolean
}

const PERFECT = new Set([0, 7])
const DISSONANT = new Set([1, 2, 5, 6, 10, 11])

/**
 * Programación dinámica sobre los ataques del bajo. Coste: saltos, notas repetidas, inversiones,
 * disonancias con la melodía (graves en parte fuerte), quintas y octavas paralelas (prohibitivas),
 * quintas y octavas directas con salto arriba, cruces; premio al movimiento contrario. Las notas
 * de paso (de la escala, fuera del acorde) solo en parte débil, llegando y saliendo por grado.
 */
export function counterpoint(slots: Slot[], melodyAt: (step: number) => number | null, lo: number, hi: number, minor: boolean, key: number): number[] {
  if (slots.length === 0) return []
  interface Cand {
    note: number
    nct: boolean
  }
  const scaleFor = (c: PChord): number[] => (minor ? (c.lead ? HARM : NAT) : MAJ)
  const cands: Cand[][] = slots.map((sl) => {
    const pcs = pcsOf(sl.c)
    const sc = scaleFor(sl.c)
    const out: Cand[] = []
    for (let m = lo; m <= hi; m++) {
      const pc = mod12(m - key)
      if (pcs.includes(pc)) out.push({ note: m, nct: false })
      else if (!sl.strong && !sl.first && sc.includes(pc)) out.push({ note: m, nct: true })
    }
    return out
  })
  const center = (lo + hi) / 2
  const local = (i: number, c: Cand): number => {
    const sl = slots[i]
    const pc = mod12(c.note - sl.c.root - key)
    let cost = Math.abs(c.note - center) / 12
    if (sl.first) cost += pc === 0 ? 0 : pc === 3 || pc === 4 ? 2 : 6
    if (c.nct) cost += 3
    const t = melodyAt(sl.step)
    if (t !== null) {
      if (t <= c.note) cost += 100
      const iv = mod12(t - c.note)
      if (DISSONANT.has(iv)) cost += c.nct ? 4 : sl.strong ? 25 : 6
      else if (PERFECT.has(iv)) cost += sl.strong ? 0.6 : 0.3
      else cost -= 0.6
    }
    return cost
  }
  const trans = (i: number, a: Cand, b: Cand): number => {
    const d = b.note - a.note
    const ad = Math.abs(d)
    let cost = ad === 0 ? 1.5 : ad <= 2 ? 0 : ad <= 5 ? 0.5 : ad <= 7 ? 1 : ad === 12 ? 1.2 : ad / 4 + 2
    if ((a.nct || b.nct) && (ad > 2 || ad === 0)) cost += 50
    const t0 = melodyAt(slots[i - 1].step)
    const t1 = melodyAt(slots[i].step)
    if (t0 !== null && t1 !== null) {
      const mt = t1 - t0
      const same = Math.sign(mt) === Math.sign(d) && d !== 0 && mt !== 0
      const iv0 = mod12(t0 - a.note)
      const iv1 = mod12(t1 - b.note)
      if (same && PERFECT.has(iv1) && iv0 === iv1) cost += 60
      else if (same && PERFECT.has(iv1) && Math.abs(mt) > 2) cost += 6
      if (Math.sign(mt) === -Math.sign(d) && d !== 0 && mt !== 0) cost -= 0.5
    }
    return cost
  }
  const n = slots.length
  const best: number[][] = cands.map((cs) => cs.map(() => Infinity))
  const back: number[][] = cands.map((cs) => cs.map(() => -1))
  cands[0].forEach((c, j) => (best[0][j] = local(0, c)))
  for (let i = 1; i < n; i++) {
    cands[i].forEach((c, j) => {
      const l = local(i, c)
      cands[i - 1].forEach((p, k) => {
        const v = best[i - 1][k] + trans(i, p, c) + l
        if (v < best[i][j]) {
          best[i][j] = v
          back[i][j] = k
        }
      })
    })
  }
  let j = best[n - 1].indexOf(Math.min(...best[n - 1]))
  const out: number[] = new Array(n)
  for (let i = n - 1; i >= 0; i--) {
    out[i] = cands[i][j]?.note ?? lo
    j = back[i][j]
  }
  return out
}

/** índice de la nota de una voz que suena en `step` */
function voiceAt(notes: MNote[]): (step: number) => number | null {
  return (step) => {
    for (const n of notes) if (n.step <= step && step < n.step + n.len) return n.note
    return null
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  El kit de orquesta
// ═════════════════════════════════════════════════════════════════════════════
const GRAN = 0
const CAJA = 1
const TIMP_V = 2
const TIMP_I = 3
const PLATO = 4
const PANDERETA = 5
const TAMBOR = 6
const PALILLOS = 7

function orchestraKit(song: Song): void {
  const tonic = 45 + mod12(song.key - 9)
  song.drumKit = [
    dv('GRAN CASSA', 'kick', 0.3, 0.8, 0.3, 0.95),
    dv('CAJA', 'snare', 0.55, 0.35, 0.7, 0.8),
    dv('TIMPANI V', 'timp', timpPitch(tonic - 5), 0.8, 0.6, 0.85),
    dv('TIMPANI I', 'timp', timpPitch(tonic), 0.75, 0.6, 0.85),
    dv('PLATO', 'crash', 0.5, 0.7, 0.45, 0.6),
    dv('PANDERETA', 'ohat', 0.7, 0.35, 0.6, 0.45),
    dv('TAMBOR', 'tom', 0.25, 0.55, 0.3, 0.8),
    dv('PALILLOS', 'rim', 0.6, 0.2, 0.5, 0.55),
  ]
}

/** golpe en el DAC sin duplicar el mismo sonido en el mismo paso (cada duplicado gasta una de las cuatro voces) */
function beat(rec: NoteRec, at: number, drum: number, vel: number): void {
  const same = rec.ch6?.find((n) => n.step === at && n.note === drum)
  if (same) same.vel = Math.max(same.vel, Math.min(15, vel))
  else put(rec, 'ch6', at, 1, drum, vel)
}

function roll(rec: NoteRec, from: number, to: number, drum: number, v0: number, v1: number): void {
  const n = Math.max(1, to - from)
  for (let s = from; s < to; s++) beat(rec, s, drum, Math.round(v0 + ((v1 - v0) * (s - from)) / n))
}

/** el timbal que cabe en el acorde: el de la tónica o el de la dominante */
function timpFor(c: PChord, prefer: 'I' | 'V' = 'I'): number | null {
  const pcs = pcsOf(c)
  const i = pcs.includes(0)
  const v = pcs.includes(7)
  if (prefer === 'I') return i ? TIMP_I : v ? TIMP_V : null
  return v ? TIMP_V : i ? TIMP_I : null
}

// ═════════════════════════════════════════════════════════════════════════════
//  Utilidades de escritura
// ═════════════════════════════════════════════════════════════════════════════
interface Ctx {
  env: Env
  rng: Rng
  song: Song
  minor: boolean
  spb: number
  key: number
}

const emitNotes = (rec: NoteRec, track: string, notes: MNote[], vel: number | ((n: MNote) => number), shift = 0, offset = 0): void => {
  for (const n of notes) put(rec, track, n.step + offset, n.len, n.note + shift, typeof vel === 'number' ? vel : vel(n))
}

/** acordes de tres voces (con conducción de voces), uno por tramo; los tramos iguales seguidos se ligan */
function writeChords(ctx: Ctx, rec: NoteRec, tracks: string[], chords: PChord[], span: number, o: { lo: number; hi: number; vel: number; len?: number; restrike?: number[]; from?: number }): void {
  let prev: number[] | null = null
  let last: PChord | null = null
  const held: (Note | null)[] = tracks.map(() => null)
  chords.forEach((c, k) => {
    const at = (o.from ?? 0) + k * span
    if (!o.len && !o.restrike && last && last.sym === c.sym && held[0]) {
      for (const n of held) if (n) n.len += span
      return
    }
    const v = padVoices(ctx.env, prev, c, o.lo, o.hi)
    // con menos pistas que voces se quedan las de arriba: la tercera no se pierde
    const off = Math.max(0, v.length - tracks.length)
    tracks.forEach((tr, i) => {
      if (v[i + off] === undefined) return
      const hits = o.restrike ?? [0]
      hits.forEach((h, hi) => {
        const next = hits[hi + 1] ?? span
        put(rec, tr, at + h, o.len ?? next - h, v[i + off], o.vel + (hi > 0 ? 1 : 0))
        const arr = rec[tr]
        held[i] = arr[arr.length - 1]
      })
    })
    prev = v
    last = c
  })
}

/** el bajo por contrapunto: ritmo por compás (`null` = silencio) */
function writeBass(ctx: Ctx, rec: NoteRec, track: string, melody: MNote[], chordAt: (s: number) => PChord, rhythm: (bar: number) => (number | null)[], bars: number, o: { lo: number; hi: number; vel: number; strong: (s: number) => boolean; from?: number }): MNote[] {
  const slots: Slot[] = []
  let lastChord: PChord | null = null
  for (let b = 0; b < bars; b++) {
    let s = b * ctx.spb
    for (const len of rhythm(b)) {
      if (len === null) continue
      if (len < 0) {
        s += -len
        continue
      }
      const c = chordAt(s)
      slots.push({ step: s, len, c, first: !lastChord || c.sym !== lastChord.sym, strong: o.strong(s % ctx.spb) })
      lastChord = c
      s += len
    }
  }
  const notes = counterpoint(slots, voiceAt(melody), o.lo, o.hi, ctx.minor, ctx.key)
  const out = slots.map((sl, i) => ({ step: sl.step + (o.from ?? 0), len: sl.len, note: notes[i] }))
  emitNotes(rec, track, out, (n) => (n.step % ctx.spb === 0 ? o.vel : o.vel - 1))
  return out
}

/** la nota del acorde que queda por debajo (tercera o sexta), o una tercera diatónica si la de arriba es de paso */
function harmonyBelow(ctx: Ctx, n: MNote, c: PChord): number {
  const pcs = pcsOf(c)
  for (let d = 3; d <= 9; d++) if (pcs.includes(mod12(n.note - d - ctx.key))) return n.note - d
  const sc = ctx.minor ? NAT : MAJ
  for (let d = 3; d <= 4; d++) if (sc.includes(mod12(n.note - d - ctx.key))) return n.note - d
  return n.note - 3
}

/** arpegio ascendente del acorde desde `base` */
function arpeggio(ctx: Ctx, c: PChord, base: number, count: number): number[] {
  const pcs = pcsOf(c)
  const out: number[] = []
  for (let m = base; out.length < count && m < base + 48; m++) if (pcs.includes(mod12(m - ctx.key))) out.push(m)
  return out
}

/** ¿la pieza está escrita en menor? (`auto` = la que traiga el tema) */
interface Themed {
  minor: boolean
}
function pickTheme<T extends Themed>(rng: Rng, list: T[], mode: PieceMode): { t: T; minor: boolean } {
  if (mode === 'auto') {
    const t = rng.pick(list)
    return { t, minor: t.minor }
  }
  const want = mode === 'minor'
  const same = list.filter((t) => t.minor === want)
  return { t: rng.pick(same.length ? same : list), minor: want }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FANFARRIA
// ═════════════════════════════════════════════════════════════════════════════
interface Fanfare extends Themed {
  name: string
  /** un acorde por medio compás */
  chords: string
  mel: string
}
const FANFARES: Fanfare[] = [
  { name: 'victoria', minor: false, chords: 'I I IV I ii V I I', mel: '-3.1 -3.1 -3.2 0.4 2.4 4.4 | 5.4 3.4 2.6 0.2 | 1.3 1.1 1.4 -1.4 4.4 | 7.16' },
  { name: 'llamada', minor: false, chords: 'I I V V I IV V I', mel: '0.3 0.1 0.3 0.1 2.4 0.4 | 4.3 4.1 4.3 4.1 -1.4 1.4 | 2.2 4.2 7.4 5.3 3.1 5.4 | 4.2 6.2 8.4 7.8' },
  { name: 'real', minor: false, chords: 'I IV I V vi IV V I', mel: '0.8 5.2 3.2 0.4 | 2.6 4.2 1.4 -1.4 | 5.3 4.1 2.4 3.3 5.1 7.4 | 6.4 4.4 7.8' },
  { name: 'torneo', minor: false, chords: 'I I IV V I vi V I', mel: '-3.1 0.1 2.1 4.1 7.4 4.2 7.2 4.4 | 5.2 7.2 5.2 3.2 4.2 6.2 8.4 | 7.3 7.1 4.4 5.3 5.1 2.4 | 4.1 6.1 8.2 6.4 7.8' },
  { name: 'ascenso', minor: false, chords: 'I V IV I ii V I I', mel: '0.2 0.2 2.2 4.2 1.2 1.2 4.2 6.2 | 3.2 3.2 5.2 7.2 2.2 2.2 4.2 7.2 | 3.2 5.2 8.2 5.2 4.2 6.2 8.2 6.2 | 7.12 r.4' },
  { name: 'tesoro', minor: false, chords: 'I I IV IV V V I I', mel: '-3.1 0.1 2.1 4.5 r.8 | -2.1 0.1 3.1 5.5 r.8 | -1.1 1.1 4.1 6.5 r.8 | 0.2 2.2 4.2 7.10' },
  { name: 'heroica', minor: true, chords: 'i i VI VII iv V i i', mel: '0.3 0.1 4.4 7.4 4.4 | 5.3 4.1 2.4 6.3 4.1 1.4 | 3.2 5.2 7.2 5.2 4.2 6.2 8.4 | 7.12 r.4' },
]

function fanfare(ctx: Ctx, mode: PieceMode): void {
  const { song, rng, spb } = ctx
  const { t, minor } = pickTheme(rng, FANFARES, mode)
  ctx.minor = minor
  const chords = parseChords(t.chords, minor)
  const chordAt = (s: number): PChord => chords[Math.min(chords.length - 1, Math.floor(s / (spb / 2)))]
  const mel = realize(parseLine(t.mel, spb), chordAt, ctx.env.midTonic + 12, minor)
  const total = 4 * spb
  setupTracks(song, {
    fm1: { inst: FM.TUBA, name: 'TUBA', vol: 49, pan: 'C', gate: 0.9 },
    fm2: { inst: FM.TROMPETA, name: 'TROMPETA II', vol: 57, pan: 'L', gate: 0.9 },
    fm3: { inst: FM.TROMPA, name: 'TROMPA I', vol: 74, pan: 'R', gate: 0.96 },
    fm4: { inst: FM.TROMPETA, name: 'TROMPETA I', vol: 92, pan: 'C', gate: 0.9 },
    fm5: { inst: FM.TROMPA, name: 'TROMPA II', vol: 72, pan: 'L', gate: 0.96 },
    ch6: { name: 'TIMBALES', vol: 100, pan: 'C' },
    sq1: { inst: PSG.LEAD, name: 'BRILLO', vol: 100, gate: 0.85 },
    sq2: { inst: PSG.PAD, name: 'TROMPA III', vol: 100 },
    sq3: { inst: PSG.ARP, name: 'DESTELLO', vol: 100 },
    noise: { name: 'REDOBLE', vol: 100 },
  })
  addSection(song, 'FANFARRIA', 4, 1, (rec) => {
    emitNotes(rec, 'fm4', mel, (n) => (n.step % 4 === 0 ? 14 : 12))
    emitNotes(rec, 'sq1', mel, 13)
    // segunda trompeta: la nota del acorde que queda debajo
    for (const n of mel) put(rec, 'fm2', n.step, n.len, harmonyBelow(ctx, n, chordAt(n.step)), n.step % 4 === 0 ? 12 : 11)
    // trompas sostenidas, un acorde por medio compás; la última nota del acorde final se queda
    writeChords(ctx, rec, ['fm3', 'fm5', 'sq2'], chords, spb / 2, { lo: ctx.env.midTonic - 10, hi: ctx.env.midTonic + 8, vel: 11 })
    // el acorde final llega al empezar el último compás o, si ese compás es V → I, a su mitad
    const half = spb / 2
    const finalAt = chords[6].sym === chords[7].sym ? 3 * spb : 3 * spb + half
    // tuba en la fundamental, con la octava en el contratiempo; la última, larga
    chords.forEach((c, k) => {
      const at = k * half
      const root = ctx.env.bassTonic + c.root - (c.root > 6 ? 12 : 0)
      if (at >= finalAt) {
        if (at === finalAt) put(rec, 'fm1', at, total - at, root, 13)
        return
      }
      put(rec, 'fm1', at, 3, root, 13)
      put(rec, 'fm1', at + 4, 3, root + 12, 10)
    })
    // percusión: marcha de caja hasta el redoble que lleva al final, timbales en cada acorde
    const MARCH = [11, 0, 7, 7, 9, 0, 7, 0, 11, 0, 7, 7, 9, 0, 7, 0]
    for (let st = 0; st < finalAt - 8; st++) if (MARCH[st % spb]) beat(rec, st, CAJA, MARCH[st % spb])
    roll(rec, finalAt - 8, finalAt, CAJA, 6, 13)
    for (let st = finalAt - 8; st < finalAt; st++) put(rec, 'noise', st, 1, NZ.SNARE, 5 + Math.round(((st - finalAt + 8) * 7) / 8))
    beat(rec, 0, GRAN, 14)
    chords.forEach((c, k) => {
      const at = k * half
      if (at >= finalAt - 4) return
      const tp = timpFor(c, k % 2 ? 'V' : 'I')
      if (tp !== null) beat(rec, at, tp, k % 2 ? 10 : 12)
    })
    roll(rec, finalAt - 4, finalAt, timpFor(chordAt(finalAt - 1), 'V') ?? TIMP_V, 9, 13)
    // el final: plato, gran cassa, timbal con su redoble y un destello que sube en el PSG
    beat(rec, finalAt, PLATO, 14)
    beat(rec, finalAt, GRAN, 15)
    beat(rec, finalAt, TIMP_I, 15)
    roll(rec, finalAt + 1, Math.min(total, finalAt + 12), TIMP_I, 9, 11)
    arpeggio(ctx, chordAt(finalAt), ctx.env.midTonic + 12, Math.min(12, total - finalAt)).forEach((note, k) => put(rec, 'sq3', finalAt + k, 1, note, 14 - (k >> 2)))
  })
  song.loopStart = -1
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAESTOSO
// ═════════════════════════════════════════════════════════════════════════════
interface Maestoso extends Themed {
  name: string
  /** registro de la melodía: grado 0 = tónica de `midTonic` + `oct` octavas */
  oct: number
  chordsA: string
  melA: string
  chordsB: string
  melB: string
}
const MAESTOSI: Maestoso[] = [
  {
    name: 'trono',
    minor: false,
    oct: 0,
    chordsA: 'I V vi iii IV I IV V',
    melA: '4.6 4.2 7.8 | 6.6 5.2 4.8 | 5.6 7.2 9.4 7.4 | 6.8 4.8 | 5.6 5.2 3.4 5.4 | 4.6 2.2 0.8 | 3.4 5.4 7.4 5.4 | 4.12 r.4',
    chordsB: 'IV V iii vi ii V/V V I',
    melB: '7.6 5.2 3.8 | 8.6 6.2 4.8 | 6.4 7.4 9.8 | 9.6 8.2 7.8 | 8.6 7.2 5.4 3.4 | 5.4 3#.4 8.8 | 4.6 6.2 8.4 6.4 | 7.16',
  },
  {
    name: 'himno',
    minor: false,
    oct: 0,
    chordsA: 'I IV I V vi IV ii V',
    melA: '0.4 2.4 4.6 4.2 | 5.8 3.8 | 2.6 4.2 7.8 | 6.8 r.4 4.4 | 2.6 0.2 2.4 5.4 | 5.6 3.2 0.8 | 1.6 3.2 5.4 3.4 | 4.12 r.4',
    chordsB: 'IV I V vi IV I V I',
    melB: '7.6 8.2 7.4 5.4 | 9.8 7.8 | 8.6 6.2 4.8 | 7.6 5.2 2.8 | 5.4 7.4 10.6 9.2 | 9.6 7.2 4.8 | 8.4 9.2 8.2 6.8 | 7.16',
  },
  {
    name: 'imperio',
    minor: true,
    oct: 0,
    chordsA: 'i VI iv V i VI iv V',
    melA: '0.6 0.2 4.8 | 5.6 4.2 2.8 | 3.6 2.2 0.4 3.4 | 1.12 r.4 | 0.6 0.2 4.6 7.2 | 7.6 5.2 2.8 | 3.4 5.4 7.4 5.4 | 6.12 r.4',
    chordsB: 'VI VII III VI iv V i i',
    melB: '7.6 9.2 7.8 | 8.6 10.2 8.8 | 9.6 11.2 13.8 | 12.6 11.2 9.8 | 10.4 9.4 10.6 12.2 | 11.12 8.4 | 7.16 | 7.12 r.4',
  },
]

function maestoso(ctx: Ctx, mode: PieceMode): void {
  const { song, rng, spb, env } = ctx
  const { t, minor } = pickTheme(rng, MAESTOSI, mode)
  ctx.minor = minor
  const base = env.midTonic + 12 * t.oct
  const chA = parseChords(t.chordsA, minor)
  const chB = parseChords(t.chordsB, minor)
  const melA = realize(parseLine(t.melA, spb), (s) => chA[Math.floor(s / spb)], base, minor)
  const melB = realize(parseLine(t.melB, spb), (s) => chB[Math.floor(s / spb)], base, minor)
  const lead = rng.chance(0.3) ? FM.TROMPA : FM.TROMPETA
  setupTracks(song, {
    fm1: { inst: rng.chance(0.5) ? FM.TUBA : FM.CELLO, name: 'BAJOS', vol: 68, pan: 'C', gate: 0.95 },
    fm2: { inst: FM.TROMPA, name: 'TROMPAS', vol: 70, pan: 'L', gate: 1 },
    fm3: { inst: FM.VIOLINS, name: 'CUERDAS', vol: 66, pan: 'R', gate: 1 },
    fm4: { inst: lead, name: lead === FM.TROMPA ? 'TROMPA' : 'TROMPETA', vol: 92, pan: 'C', gate: 0.94 },
    fm5: { inst: FM.VIOLINS, name: 'CUERDAS', vol: 64, pan: 'L', gate: 1 },
    ch6: { name: 'TIMBALES', vol: 100, pan: 'C' },
    sq1: { inst: PSG.PLUCK, name: 'ARPA', vol: 100 },
    sq2: { inst: PSG.LEAD, name: 'BRILLO', vol: 100 },
    sq3: { inst: PSG.LEAD, name: 'VOZ 2', vol: 100 },
    noise: { name: 'PLATILLOS', vol: 100 },
  })
  const bassRange = { lo: env.bassTonic - 5, hi: env.bassTonic + 16 }
  const harp = (rec: NoteRec, chords: PChord[], bars: number, vel: number): void => {
    for (let b = 0; b < bars; b++) {
      const ser = arpeggio(ctx, chords[b], env.midTonic, 6)
      ;[0, 1, 2, 3, 4, 3, 2, 1].forEach((k, i) => put(rec, 'sq1', b * spb + i * 2, 2, ser[k], vel - (i % 2)))
    }
  }
  const timpani = (rec: NoteRec, chords: PChord[], bars: number): void => {
    for (let b = 0; b < bars; b++) {
      const tp = timpFor(chords[b], b % 2 ? 'V' : 'I')
      if (tp !== null) beat(rec, b * spb, tp, b % 4 === 0 ? 13 : 11)
      if (b % 4 === 3) {
        const r = timpFor(chords[b], 'V') ?? TIMP_V
        roll(rec, b * spb + 8, (b + 1) * spb, r, 7, 12)
      }
    }
  }

  addSection(song, 'INTRO', 2, 1, (rec) => {
    const I = parseChords(minor ? 'i' : 'I', minor)[0]
    const V = parseChords('V7', minor)[0]
    writeChords(ctx, rec, ['fm2', 'fm3', 'fm5'], [I, V], spb, { lo: env.midTonic - 12, hi: env.midTonic + 7, vel: 10 })
    put(rec, 'fm1', 0, spb, env.bassTonic, 12)
    put(rec, 'fm1', spb, spb, env.bassTonic - 5, 12)
    roll(rec, 0, spb, TIMP_I, 5, 11)
    roll(rec, spb, 2 * spb - 4, TIMP_V, 8, 13)
    roll(rec, 2 * spb - 4, 2 * spb, CAJA, 7, 12)
    // la llamada: tres notas en la dominante que desembocan en el tema
    const call = realize(parseLine('r.16 | r.8 4.3 4.1 4.4', spb), () => V, base, minor)
    emitNotes(rec, 'fm4', call, 13)
  })
  addSection(song, 'A', 8, 1, (rec) => {
    emitNotes(rec, 'fm4', melA, (n) => (n.step % 8 === 0 ? 14 : 13))
    writeChords(ctx, rec, ['fm2', 'fm3', 'fm5'], chA, spb, { lo: env.midTonic - 9, hi: env.midTonic + 8, vel: 10 })
    writeBass(ctx, rec, 'fm1', melA, (s) => chA[Math.floor(s / spb)], (b) => (b === 7 ? [12, 4] : [8, 8]), 8, { ...bassRange, vel: 13, strong: (s) => s % 8 === 0 })
    harp(rec, chA, 8, 15)
    timpani(rec, chA, 8)
    beat(rec, 0, PLATO, 12)
    beat(rec, 0, GRAN, 14)
  })
  addSection(song, 'B', 8, 1, (rec) => {
    emitNotes(rec, 'fm4', melB, (n) => (n.step % 8 === 0 ? 14 : 13))
    emitNotes(rec, 'sq2', melB, 10, 12)
    for (const n of melB) put(rec, 'sq3', n.step, n.len, harmonyBelow(ctx, n, chB[Math.floor(n.step / spb)]), 9)
    writeChords(ctx, rec, ['fm2', 'fm3', 'fm5'], chB, spb, { lo: env.midTonic - 9, hi: env.midTonic + 8, vel: 11 })
    writeBass(ctx, rec, 'fm1', melB, (s) => chB[Math.floor(s / spb)], (b) => (b === 7 ? [16] : [8, 8]), 8, { ...bassRange, vel: 13, strong: (s) => s % 8 === 0 })
    harp(rec, chB, 8, 15)
    timpani(rec, chB, 7)
    beat(rec, 0, PLATO, 13)
    beat(rec, 0, GRAN, 15)
    beat(rec, 6 * spb, PLATO, 12)
    // cierre: tónica con plato, y redoble de caja que vuelve a A
    beat(rec, 7 * spb, TIMP_I, 14)
    beat(rec, 7 * spb, GRAN, 14)
    roll(rec, 7 * spb + 8, 8 * spb, CAJA, 6, 12)
    for (let s = 7 * spb + 8; s < 8 * spb; s++) put(rec, 'noise', s, 1, NZ.SNARE, 4 + ((s - 7 * spb - 8) >> 1))
  })
  song.loopStart = 1
}

// ═════════════════════════════════════════════════════════════════════════════
//  Danzas en forma binaria: BOURRÉE · GIGA · ZARABANDA
// ═════════════════════════════════════════════════════════════════════════════
interface Dance extends Themed {
  name: string
  /** registro del tiple: grado 0 = tónica de `midTonic` + `oct` octavas */
  oct: number
  /** acordes por tramo (medio compás en la bourrée y la giga, compás en la zarabanda) */
  chordsA: string
  melA: string
  chordsB: string
  melB: string
}

const BOURREES: Dance[] = [
  {
    name: 'en menor',
    minor: true,
    oct: 1,
    chordsA: 'i i V i iv i V V i iv VII III iv V i i',
    melA: '4.4 2.4 0.2 1.2 2.4 | 1.4 -1.4 0.8 | 3.4 5.4 4.2 3.2 2.4 | -1.2 0.2 1.2 2.2 1.8 | 4.4 7.4 5.2 4.2 3.4 | 3.4 6.4 4.2 3.2 2.4 | 3.2 2.2 1.2 0.2 -1.4 1.4 | 0.8 r.4 2.2 3.2',
    chordsB: 'III III VII III iv VII III V VI iv ii° V i V i i',
    melB: '4.4 6.4 6.2 4.2 2.4 | 3.4 1.4 2.8 | 5.4 3.4 1.2 3.2 6.4 | 4.4 2.4 1.8 | 2.4 5.4 3.2 5.2 7.4 | 8.2 7.2 6.2 5.2 4.4 1.4 | 0.4 2.2 1.2 -1.2 0.2 1.4 | 0.8 r.4 2.2 3.2',
  },
  {
    name: 'de palacio',
    minor: false,
    oct: 0,
    chordsA: 'I I V I IV I ii V I vi IV I ii V I I',
    melA: '7.4 9.4 11.2 9.2 7.4 | 8.4 6.4 7.8 | 10.4 12.4 11.2 10.2 9.4 | 8.2 9.2 10.2 8.2 6.8 | 7.4 11.4 12.2 11.2 9.4 | 10.4 9.2 8.2 7.4 11.4 | 10.2 9.2 8.2 7.2 6.4 8.4 | 7.8 r.4 5.2 6.2',
    chordsB: 'V V I V vi iii IV V I IV ii V I V I I',
    melB: '8.4 11.4 13.2 11.2 8.4 | 9.4 7.4 8.8 | 12.4 9.4 13.2 11.2 9.4 | 10.4 12.4 11.8 | 9.4 11.4 12.2 10.2 7.4 | 8.4 10.2 12.2 11.4 8.4 | 9.2 8.2 7.2 9.2 8.4 6.4 | 7.8 r.4 5.2 6.2',
  },
]

const GIGUES: Dance[] = [
  {
    name: 'en mayor',
    minor: false,
    oct: 0,
    chordsA: 'I I IV V I I IV V vi ii V I IV V I I',
    melA: '0.2 2.2 4.2 7.4 4.2 | 5.2 7.2 5.2 4.4 6.2 | 9.6 7.4 9.2 | 12.4 10.2 11.4 8.2 | 9.2 7.2 5.2 8.2 10.2 12.2 | 11.4 8.2 7.4 4.2 | 5.2 6.2 7.2 8.4 6.2 | 7.6 r.6',
    chordsB: 'V V I IV V V I IV ii V I vi IV V I I',
    melB: '8.2 6.2 4.2 1.4 4.2 | 7.2 4.2 2.2 5.4 3.2 | 11.6 13.4 11.2 | 9.6 10.4 12.2 | 8.2 10.2 12.2 11.4 8.2 | 9.4 7.2 5.4 9.2 | 10.2 12.2 10.2 8.4 6.2 | 7.6 r.6',
  },
  {
    name: 'de taberna',
    minor: true,
    oct: 0,
    chordsA: 'i i iv V i i iv V VI III iv V i V i i',
    melA: '4.4 2.2 0.4 2.2 | 3.4 5.2 4.4 1.2 | 9.6 9.4 7.2 | 5.4 7.2 8.4 6.2 | 2.2 0.2 -2.2 2.2 4.2 2.2 | 3.2 5.2 3.2 1.4 -1.2 | 0.2 2.2 4.2 1.4 -1.2 | 0.6 r.6',
    chordsB: 'III III VII III III III VII III iv i VI V iv V i i',
    melB: '2.4 4.2 6.4 4.2 | 3.4 1.2 2.4 4.2 | 9.6 6.4 9.2 | 6.4 8.2 4.4 2.2 | 3.2 5.2 7.2 4.4 2.2 | 5.4 2.2 4.4 1.2 | 3.2 5.2 3.2 1.2 -1.2 1.2 | 0.6 r.6',
  },
]

const SARABANDES: Dance[] = [
  {
    name: 'lamento',
    minor: true,
    oct: 0,
    chordsA: 'i iv V i VI iv V V',
    melA: '4.4 7.6 5.2 | 3.4 5.8 | 6.4 8.6 7.2 | 7.4 4.8 | 9.4 12.6 10.2 | 10.4 12.6 11.2 | 11.4 8.6 6.2 | 8.8 r.4',
    chordsB: 'III VII iv i VI ii° V i',
    melB: '9.4 13.6 11.2 | 10.4 8.6 10.2 | 12.4 10.6 9.2 | 7.4 11.8 | 12.4 9.6 7.2 | 10.4 12.6 11.2 | 11.4 8.8~ | 8.4 7.8',
  },
  {
    name: 'real',
    minor: false,
    oct: 0,
    chordsA: 'I IV V I vi ii V V',
    melA: '7.4 11.6 10.2 | 10.4 12.8 | 11.4 13.6 12.2 | 11.4 9.8 | 12.4 14.6 12.2 | 10.4 12.6 11.2 | 11.4 8.6 6.2 | 8.8 r.4',
    chordsB: 'iii vi IV I ii V V I',
    melB: '9.4 13.6 11.2 | 12.4 9.8 | 10.4 14.6 12.2 | 11.4 7.8 | 8.4 12.6 10.2 | 11.4 13.6 12.2 | 11.4 8.8~ | 8.4 7.8',
  },
]

/** la repetición ornamentada: mordentes en las notas largas de las partes fuertes */
function ornament(notes: MNote[], spb: number, ctx: Ctx): Note[] {
  const plain: Note[] = notes.map((n) => ({ step: n.step, len: n.len, note: n.note, vel: n.step % spb === 0 ? 13 : 12 }))
  const sc = (ctx.minor ? NAT : MAJ).map((x) => mod12(x + ctx.key))
  return mordent(plain, (n) => n.len >= 6 && n.step % (spb / 2) === 0, sc)
}

function bourree(ctx: Ctx, mode: PieceMode): void {
  const { song, rng, spb, env } = ctx
  const { t, minor } = pickTheme(rng, BOURREES, mode)
  ctx.minor = minor
  const base = env.midTonic + 12 * t.oct
  const flute = rng.chance(0.5)
  setupTracks(song, {
    fm1: { inst: FM.CLAVE, name: 'BAJO', vol: 92, pan: 'C', gate: 0.9 },
    fm2: { inst: FM.CLAVE, name: 'CONTINUO', vol: 66, pan: 'L', gate: 0.85 },
    fm3: { inst: FM.CLAVE, name: 'CONTINUO', vol: 64, pan: 'R', gate: 0.85 },
    fm4: { inst: flute ? FM.OBOE : FM.CLAVE, name: flute ? 'OBOE' : 'CLAVE', vol: 92, pan: 'C', gate: 0.88 },
    fm5: { inst: FM.FLUTE, name: 'FLAUTA', vol: 64, pan: 'R', gate: 0.9 },
    ch6: { name: 'PANDERETA', vol: 100, pan: 'C' },
    sq1: { inst: PSG.PLUCK, name: 'CUERDA', vol: 100 },
  })
  for (const part of ['A', 'B'] as const) {
    const chords = parseChords(part === 'A' ? t.chordsA : t.chordsB, minor)
    const chordAt = (s: number): PChord => chords[Math.floor(s / (spb / 2))]
    const mel = realize(parseLine(part === 'A' ? t.melA : t.melB, spb), chordAt, base, minor)
    const rhythm = (b: number): (number | null)[] => (b === 7 ? [8, -4, 4] : b === 3 ? [4, 4, 8] : [4, 4, 4, 4])
    for (const pass of [1, 2]) {
      addSection(song, `${part}${pass}`, 8, 1, (rec) => {
        if (pass === 1) emitNotes(rec, 'fm4', mel, (n) => (n.step % 8 === 0 ? 13 : 12))
        else for (const n of ornament(mel, spb, ctx)) put(rec, 'fm4', n.step, n.len, n.note, n.vel, n)
        writeBass(ctx, rec, 'fm1', mel, chordAt, rhythm, 8, { lo: env.bassTonic, hi: env.bassTonic + 19, vel: 12, strong: (s) => s % 8 === 0 })
        writeChords(ctx, rec, ['fm2', 'fm3'], chords, spb / 2, { lo: env.midTonic - 7, hi: env.midTonic + 7, vel: 9, len: 3 })
        if (pass === 2) {
          emitNotes(rec, 'fm5', mel, 10, 12)
          for (let b = 0; b < 8; b++) {
            beat(rec, b * spb, TAMBOR, 11)
            beat(rec, b * spb + 4, PANDERETA, 8)
            beat(rec, b * spb + 12, PANDERETA, 8)
            if (b % 2 === 1) beat(rec, b * spb + 14, PALILLOS, 7)
          }
        } else beat(rec, 0, TAMBOR, 10)
      })
    }
  }
  song.loopStart = 0
}

function gigue(ctx: Ctx, mode: PieceMode): void {
  const { song, rng, spb, env } = ctx
  const { t, minor } = pickTheme(rng, GIGUES, mode)
  ctx.minor = minor
  const base = env.midTonic + 12 * t.oct
  const tavern = t.name === 'de taberna' ? rng.chance(0.75) : rng.chance(0.35)
  setupTracks(song, {
    fm1: { inst: tavern ? FM.PIZZICATO : FM.CLAVE, name: 'BAJO', vol: 92, pan: 'C', gate: 0.9 },
    fm2: { inst: FM.CLAVE, name: 'CONTINUO', vol: 62, pan: 'L', gate: 0.8 },
    fm3: { inst: FM.CLAVE, name: 'CONTINUO', vol: 60, pan: 'R', gate: 0.8 },
    fm4: { inst: tavern ? FM.FLUTE : FM.CLAVE, name: tavern ? 'FLAUTA' : 'CLAVE', vol: 92, pan: 'C', gate: 0.9 },
    fm5: { inst: tavern ? FM.VIOLIN : FM.OBOE, name: tavern ? 'VIOLÍN' : 'OBOE', vol: 70, pan: 'R', gate: 0.9 },
    ch6: { name: tavern ? 'BODHRÁN' : 'TAMBOR', vol: 100, pan: 'C' },
    sq1: { inst: PSG.PLUCK, name: 'CUERDA', vol: 100 },
  })
  for (const part of ['A', 'B'] as const) {
    const chords = parseChords(part === 'A' ? t.chordsA : t.chordsB, minor)
    const chordAt = (s: number): PChord => chords[Math.floor(s / (spb / 2))]
    const line = parseLine(part === 'A' ? t.melA : t.melB, spb)
    const mel = realize(line, chordAt, base, minor)
    // la imitación: el bajo repite el sujeto (los dos primeros compases) una octava por debajo en los compases 3 y 4
    const subject = realize(
      line.filter((n) => n.step < 2 * spb).map((n) => ({ ...n, step: n.step + 2 * spb, deg: n.deg - 7 })),
      chordAt,
      base - 12 * (t.oct === 1 ? 1 : 0),
      minor,
    )
    for (const pass of [1, 2]) {
      addSection(song, `${part}${pass}`, 8, 1, (rec) => {
        if (pass === 1) emitNotes(rec, 'fm4', mel, (n) => (n.step % 6 === 0 ? 13 : 12))
        else for (const n of ornament(mel, spb, ctx)) put(rec, 'fm4', n.step, n.len, n.note, n.vel, n)
        emitNotes(rec, 'fm1', subject, (n) => (n.step % 6 === 0 ? 12 : 11))
        const later = mel.filter((n) => n.step >= 4 * spb)
        writeBass(ctx, rec, 'fm1', later, chordAt, (b) => (b < 4 ? [-spb] : b === 7 ? [6, -6] : [4, 2, 4, 2]), 8, {
          lo: env.bassTonic,
          hi: env.bassTonic + 19,
          vel: 12,
          strong: (s) => s % 6 === 0,
        })
        // continuo: un acorde corto por compás desde que entra el bajo
        writeChords(ctx, rec, ['fm2', 'fm3'], chords.slice(4), spb / 2, { lo: env.midTonic - 7, hi: env.midTonic + 7, vel: 8, len: 2, from: 2 * spb })
        if (pass === 2) {
          emitNotes(rec, 'fm5', mel, 10)
          if (tavern)
            for (let b = 0; b < 8; b++) {
              beat(rec, b * spb, TAMBOR, 12)
              beat(rec, b * spb + 6, TAMBOR, 9)
              beat(rec, b * spb + 10, PALILLOS, 6)
              beat(rec, b * spb + 4, PANDERETA, 7)
            }
        }
        if (tavern && pass === 1) for (let b = 4; b < 8; b++) beat(rec, b * spb, TAMBOR, 10)
      })
    }
  }
  song.loopStart = 0
}

function sarabande(ctx: Ctx, mode: PieceMode): void {
  const { song, rng, spb, env } = ctx
  const { t, minor } = pickTheme(rng, SARABANDES, mode)
  ctx.minor = minor
  const base = env.midTonic + 12 * t.oct
  const chapel = rng.chance(0.4)
  setupTracks(song, {
    fm1: { inst: FM.CELLO, name: 'CHELO', vol: 72, pan: 'C', gate: 0.96 },
    fm2: { inst: chapel ? FM.ORGAN : FM.VIOLINS, name: chapel ? 'ÓRGANO' : 'CUERDAS', vol: chapel ? 41 : 46, pan: 'L', gate: 0.98 },
    fm3: { inst: chapel ? FM.ORGAN : FM.VIOLINS, name: chapel ? 'ÓRGANO' : 'CUERDAS', vol: chapel ? 39 : 45, pan: 'R', gate: 0.98 },
    fm4: { inst: chapel ? FM.OBOE : FM.VIOLIN, name: chapel ? 'OBOE' : 'VIOLÍN', vol: 92, pan: 'C', gate: 0.96, glide: 3 },
    fm5: { inst: chapel ? FM.CHOIR : FM.VIOLINS, name: chapel ? 'CORO' : 'CUERDAS', vol: chapel ? 41 : 43, pan: 'C', gate: 0.98 },
    ch6: { name: 'TIMBALES', vol: 100, pan: 'C' },
    sq1: { inst: PSG.PAD, name: 'VOZ 2', vol: 100 },
  })
  for (const part of ['A', 'B'] as const) {
    const chords = parseChords(part === 'A' ? t.chordsA : t.chordsB, minor)
    const chordAt = (s: number): PChord => chords[Math.floor(s / spb)]
    const mel = realize(parseLine(part === 'A' ? t.melA : t.melB, spb), chordAt, base, minor)
    for (const pass of [1, 2]) {
      addSection(song, `${part}${pass}`, 8, 1, (rec) => {
        if (pass === 1) emitNotes(rec, 'fm4', mel, (n) => (n.step % spb === 4 ? 14 : 12))
        else for (const n of ornament(mel, spb, ctx)) put(rec, 'fm4', n.step, n.len, n.note, n.step % spb === 4 ? 14 : n.vel, n)
        // las cuerdas atacan en el primer tiempo y vuelven a cargar en el segundo
        writeChords(ctx, rec, ['fm2', 'fm3', 'fm5'], chords, spb, { lo: env.midTonic - 8, hi: env.midTonic + 9, vel: 9, restrike: [0, 4] })
        writeBass(ctx, rec, 'fm1', mel, chordAt, (b) => (b === 7 ? [12] : [4, 8]), 8, { lo: env.bassTonic - 3, hi: env.bassTonic + 17, vel: 12, strong: (s) => s === 0 || s === 4 })
        if (pass === 2) for (const n of mel) put(rec, 'sq1', n.step, n.len, harmonyBelow(ctx, n, chordAt(n.step)), 12)
        // timbal suave en las cadencias, en el segundo tiempo
        for (const b of [3, 7]) {
          const tp = timpFor(chords[b], 'V')
          if (tp !== null) beat(rec, b * spb + 4, tp, pass === 2 ? 11 : 9)
        }
      })
    }
  }
  song.loopStart = 0
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGITATO
// ═════════════════════════════════════════════════════════════════════════════
interface Agitato extends Themed {
  name: string
  chordsA: string
  melA: string
  chordsB: string
  melB: string
}
const AGITATI: Agitato[] = [
  {
    name: 'persecución',
    minor: true,
    chordsA: 'i i VI VI iv iv V V i i VI VI ii° ii° V V',
    melA: '4.1 4.1 4.2 7.3 6.1 4.4 r.2 2.2 | 5.1 5.1 5.2 9.3 7.1 5.4 r.4 | 3.2 5.2 7.2 10.2 12.3 10.1 7.4 | 4.3 6.1 8.4 6.2 4.2 1.4 | 7.1 7.1 7.2 11.3 9.1 7.4 r.4 | 9.2 8.2 9.2 12.2 14.4 12.4 | 8.2 10.2 12.2 10.2 8.2 7.2 6.2 5.2 | 4.4 6.4 8.8',
    chordsB: 'VI VII i i VII i ii° V VI VI iv iv V V V V',
    melB: '9.2 9.2 12.4 10.2 10.2 13.4 | 11.2 11.2 14.4 11.4 7.4 | 10.2 8.2 10.4 11.2 9.2 7.4 | 8.4 12.4 11.4 8.4 | 12.1 12.1 12.2 14.3 12.1 9.8 | 10.1 10.1 10.2 12.3 10.1 7.8 | 8.1 8.1 8.2 11.3 8.1 6.4 4.4 | 6.2 7.2 8.2 9.2 10.2 11.2 12.2 13.2',
  },
  {
    name: 'círculo de quintas',
    minor: true,
    chordsA: 'i i iv iv VII VII III III VI VI ii° ii° V V V V',
    melA: '7.2 7.1 7.1 4.2 2.2 0.4 4.4 | 10.2 10.1 10.1 7.2 5.2 3.4 7.4 | 6.2 6.1 6.1 3.2 1.2 -1.4 3.4 | 9.2 9.1 9.1 6.2 4.2 2.4 6.4 | 12.2 12.1 12.1 9.2 7.2 5.4 9.4 | 8.2 8.1 8.1 5.2 3.2 1.4 5.4 | 11.2 11.1 11.1 8.2 6.2 4.4 8.4 | 13.4 11.4 8.4 6.4',
    chordsB: 'VI VI VII VII i i i i iv iv V V i VI V V',
    melB: '5.1 5.1 7.1 9.1 12.4 9.1 7.1 5.1 7.1 9.4 | 6.1 6.1 8.1 10.1 13.4 10.1 8.1 6.1 8.1 10.4 | 7.1 7.1 9.1 11.1 14.4 11.1 9.1 7.1 9.1 11.4 | 14.2 13.2 12.2 11.2 10.2 9.2 8.2 7.2 | 10.3 10.1 12.4 10.3 10.1 7.4 | 11.3 11.1 13.4 11.3 11.1 8.4 | 14.4 11.4 12.4 9.4 | 6.2 7.2 8.2 9.2 10.2 11.2 12.2 13.2',
  },
]

function agitato(ctx: Ctx, mode: PieceMode): void {
  const { song, rng, spb, env } = ctx
  const { t, minor } = pickTheme(rng, AGITATI, mode)
  ctx.minor = minor
  const violin = rng.chance(0.4)
  setupTracks(song, {
    fm1: { inst: FM.CELLO, name: 'CONTRABAJOS', vol: 72, pan: 'C', gate: 0.8 },
    fm2: { inst: FM.SPICCATO, name: 'TRÉMOLO', vol: 64, pan: 'L', gate: 0.9 },
    fm3: { inst: FM.SPICCATO, name: 'TRÉMOLO', vol: 62, pan: 'R', gate: 0.9 },
    fm4: { inst: violin ? FM.VIOLIN : FM.TROMPETA, name: violin ? 'VIOLÍN' : 'TROMPETA', vol: 92, pan: 'C', gate: 0.88 },
    fm5: { inst: FM.TROMPA, name: 'TROMPAS', vol: 70, pan: 'C', gate: 0.7 },
    ch6: { name: 'PERCUSIÓN', vol: 100, pan: 'C' },
    sq1: { inst: PSG.LEAD, name: 'BRILLO', vol: 100, gate: 0.85 },
    sq2: { inst: PSG.ECHO, name: 'ECO', vol: 100 },
    noise: { name: 'CHARLES', vol: 100 },
  })
  /** trémolo, bajo, golpes de trompa, batería y charles de un tramo de compases */
  const accomp = (rec: NoteRec, chords: PChord[], bars: number, vel: number, o: { drums?: boolean } = {}): void => {
    const half = spb / 2
    let prev: number[] | null = null
    chords.slice(0, bars * 2).forEach((c, k) => {
      const at = k * half
      const v = padVoices(env, prev, c, env.midTonic - 5, env.midTonic + 12)
      prev = v
      for (let s = 0; s < half; s++) {
        put(rec, 'fm2', at + s, 1, v[0], vel - (s % 2 ? 3 : 0))
        put(rec, 'fm3', at + s, 1, v[1], vel - 1 - (s % 2 ? 3 : 0))
      }
      const root = env.bassTonic + c.root - (c.root > 6 ? 12 : 0)
      const next = chords[k + 1]
      for (let s = 0; s < half; s += 2) {
        let n = s % 4 === 0 ? root : root + 12
        if (s === half - 2 && next && next.sym !== c.sym) n = env.bassTonic + next.root - (next.root > 6 ? 12 : 0) - 1
        put(rec, 'fm1', at + s, 2, n, s === 0 ? 13 : 11)
      }
      for (const s of [0, 3, 6]) put(rec, 'fm5', at + s, 2, v[2], s === 0 ? 12 : 10)
    })
    if (o.drums === false) return
    for (let b = 0; b < bars; b++) {
      const at = b * spb
      for (const [s, v] of [[0, 14], [3, 10], [8, 13], [11, 10]] as const) beat(rec, at + s, GRAN, v)
      beat(rec, at + 4, CAJA, 12)
      beat(rec, at + 12, CAJA, 12)
      beat(rec, at + 7, CAJA, 6)
      beat(rec, at + 15, CAJA, 6)
      const tp = timpFor(chords[b * 2], 'I')
      if (tp !== null) beat(rec, at, tp, 12)
      for (let s = 0; s < spb; s++) put(rec, 'noise', at + s, 1, NZ.HAT, s % 4 === 0 ? 10 : s % 2 === 0 ? 8 : 6)
    }
  }
  const chA = parseChords(t.chordsA, minor)
  const chB = parseChords(t.chordsB, minor)
  const melA = realize(parseLine(t.melA, spb), (s) => chA[Math.floor(s / (spb / 2))], env.midTonic, minor)
  const melB = realize(parseLine(t.melB, spb), (s) => chB[Math.floor(s / (spb / 2))], env.midTonic, minor)

  addSection(song, 'INTRO', 2, 1, (rec) => {
    const I = chA.slice(0, 1)
    accomp(rec, [I[0], I[0], I[0], I[0]], 2, 9, { drums: false })
    roll(rec, 0, 2 * spb - 4, TIMP_I, 5, 12)
    roll(rec, 2 * spb - 4, 2 * spb, CAJA, 8, 13)
  })
  addSection(song, 'A', 8, 1, (rec) => {
    accomp(rec, chA, 8, 11)
    emitNotes(rec, 'fm4', melA, (n) => (n.step % 4 === 0 ? 14 : 12))
    emitNotes(rec, 'sq1', melA, 12, 12)
    emitNotes(rec, 'sq2', melA, 9, 0, 3)
    beat(rec, 0, PLATO, 13)
  })
  addSection(song, 'B', 8, 1, (rec) => {
    accomp(rec, chB, 8, 12)
    emitNotes(rec, 'fm4', melB, (n) => (n.step % 4 === 0 ? 14 : 12))
    emitNotes(rec, 'sq1', melB, 12, 12)
    emitNotes(rec, 'sq2', melB, 9, 0, 3)
    beat(rec, 0, PLATO, 14)
    beat(rec, 4 * spb, PLATO, 12)
    roll(rec, 7 * spb + 8, 8 * spb, CAJA, 7, 13)
  })
  song.loopStart = 1
}

// ═════════════════════════════════════════════════════════════════════════════
//  Generación
// ═════════════════════════════════════════════════════════════════════════════
export interface PieceOptions {
  piece: PieceId
  seed: number
  /** tónica 0-11 (0 = Do) */
  key: number
  mode?: PieceMode
  bpm?: number
}

const BUILD: Record<PieceId, (ctx: Ctx, mode: PieceMode) => void> = { fanfare, maestoso, bourree, gigue, sarabande, agitato }

/** todo el material escrito de una pieza, para comprobarlo */
export const PIECE_THEMES = { fanfare: FANFARES, maestoso: MAESTOSI, bourree: BOURREES, gigue: GIGUES, sarabande: SARABANDES, agitato: AGITATI }

export function generatePiece(o: PieceOptions): Song {
  const info = PIECES.find((p) => p.id === o.piece) ?? PIECES[0]
  const rng = new Rng(o.seed * 7919 + info.id.length * 977 + 13)
  const song = createEmptySong()
  song.key = Math.max(0, Math.min(11, Math.round(o.key)))
  song.beatsPerBar = info.beats
  song.bpm = o.bpm ?? rng.int(info.bpm[0], info.bpm[1])
  song.title = `${info.name} ${String(o.seed % 10000).padStart(4, '0')}`
  song.patterns = []
  song.order = []
  orchestraKit(song)
  const env = makeEnv(song, rng)
  const ctx: Ctx = { env, rng, song, minor: false, spb: env.spb, key: song.key }
  BUILD[info.id](ctx, o.mode ?? 'auto')
  song.scale = ctx.minor ? 'minor' : 'major'
  env.scale = (ctx.minor ? NAT : MAJ).slice()
  applyMix(song, info.id)
  return song
}
