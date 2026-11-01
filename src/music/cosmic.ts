// ── COSMIC DISCO: space disco serio, en menor y teatral ──────────────────────
//
// Aquí manda la curaduría, no el azar. Cada tema sale de:
//   · una progresión en menor con cadencia de verdad (lamento, círculo de
//     quintas, canon, napolitana…): dominante mayor con su sensible y la segunda
//     rebajada donde toca, nunca fuera de esos compases;
//   · una idea melódica escrita a mano que se desarrolla como un período
//     clásico: exposición · secuencia sobre los acordes siguientes · clímax más
//     agudo (con la misma idea o con una de contraste) · cadencia;
//   · un reparto fijo: bajo secuenciado, cuerdas a tres voces con el coro arriba,
//     arpegio con eco, segunda voz para el final y timbales afinados a la
//     tonalidad (tónica y dominante) con plato en las entradas.
// La intro prepara con pedal de tónica o anunciando el tema a lo lejos, el
// puente lo canta a mitad de velocidad hasta la dominante y la coda cierra con
// cadencia perfecta.
//
// Nada se repite compás a compás: el bajo y la batería tienen variante, giro de
// mitad de frase y cierre; el tema liga las notas cortas (con un punto de
// portamento) y ataca las largas. Los niveles del PSG están escritos para la
// calibración de la consola: van cerca del máximo porque el chip no da más.
import {
  ARP_SHAPES,
  X,
  addSection,
  bassRoot,
  chordPcs,
  dv,
  hiss,
  hit,
  padVoices,
  riser,
  roll,
  setScale,
  setupTracks,
  writeArp,
  writeBass,
  writeEcho,
  writeMelody,
  writePads,
  type BassPat,
  type Env,
  type Harm,
} from './electrokit'
import { DR, FM, NZ, PSG, put, type FillKind, type NoteRec } from './genkit'
import { timpPitch, type Pan } from './song'
import { diatonicChord, type ChordType } from './theory'

const mod7 = (n: number): number => ((n % 7) + 7) % 7
const mod12 = (n: number): number => ((n % 12) + 12) % 12

// ═════════════════════════════════════════════════════════════════════════════
//  Armonía
// ═════════════════════════════════════════════════════════════════════════════
/**
 * escala que rige un compás: natural · armónica (sensible, sobre la dominante) · frigia (segunda
 * rebajada, sobre la napolitana). Mayor y mixolidia no las usa COSMIC DISCO, que es siempre menor:
 * son para quien reutilice el motor de temas en otra tonalidad.
 */
export type Mode = 'nat' | 'harm' | 'phr' | 'maj' | 'mix'
export const MODES: Record<Mode, number[]> = {
  nat: [0, 2, 3, 5, 7, 8, 10],
  harm: [0, 2, 3, 5, 7, 8, 11],
  phr: [0, 1, 3, 5, 7, 8, 10],
  maj: [0, 2, 4, 5, 7, 9, 11],
  mix: [0, 2, 4, 5, 7, 9, 10],
}

/** acorde con su grado en la escala (0 = i … 6 = VII) y el modo de su compás */
export interface Deg extends Harm {
  deg: number
  mode: Mode
}
export const dg = (deg: number, type: ChordType, mode: Mode = 'nat'): Deg => ({ root: MODES[mode][deg], type, deg, mode })

const CH: Record<string, Deg> = {
  i: dg(0, 'min'),
  'ii°': dg(1, 'dim'),
  bII: dg(1, 'maj', 'phr'),
  III: dg(2, 'maj'),
  iv: dg(3, 'min'),
  iv7: dg(3, 'min7'),
  V: dg(4, 'maj', 'harm'),
  V7: dg(4, 'dom7', 'harm'),
  VI: dg(5, 'maj'),
  VImaj7: dg(5, 'maj7'),
  VII: dg(6, 'maj'),
}

function chords(src: string): Deg[] {
  return src
    .split(/[\s|]+/)
    .filter(Boolean)
    .map((name) => {
      const c = CH[name]
      if (!c) throw new Error(`acorde desconocido: ${name}`)
      return c
    })
}

export interface CosmicProg {
  name: string
  /** ocho compases: dos frases de cuatro */
  full: Deg[]
  /** versión de cuatro compases para secciones cortas */
  short: Deg[]
}
const progression = (name: string, full: string, short: string): CosmicProg => ({ name, full: chords(full), short: chords(short) })

/** todas acaban en la dominante (el bucle resuelve al volver) o en dominante → tónica */
export const COSMIC_PROGS: CosmicProg[] = [
  progression('LAMENTO', 'i VII VI V | i VII VI V7', 'i VII VI V'), // tetracordo descendente (cadencia andaluza)
  progression('CÍRCULO', 'i iv7 VII III | VImaj7 ii° V7 i', 'i iv7 V7 i'), // círculo de quintas completo
  progression('ÉPICA', 'i VI III VII | i VI iv V', 'i VI iv V'),
  progression('ASCENSO', 'i III iv V | VI iv V7 i', 'i III iv V'), // sube a la dominante, cadencia rota y cierre
  progression('CANON', 'i V VI III | iv i iv V', 'i V VI V'), // el canon de Pachelbel en menor
  progression('NAPOLITANA', 'i iv bII V | i VI bII V7', 'i iv bII V'),
  progression('MARCHA', 'i i VI VII | i i VI V', 'i VI VII V'),
  progression('HEROICA', 'i VII VI VII | i VII VI V', 'i VII VI V'),
]

// ═════════════════════════════════════════════════════════════════════════════
//  Ideas melódicas
// ═════════════════════════════════════════════════════════════════════════════
/** nota de una célula: paso, duración y grado diatónico sobre la fundamental del acorde (0 raíz · 2 tercera · 4 quinta · 7 octava) */
export interface MNote {
  s: number
  l: number
  d: number
}

/** "4.6 3.2 2.4 0.4" → grado.duración en semicorcheas, una nota tras otra; r = silencio. Cada célula llena un compás de 4/4 */
export function cell(src: string): MNote[] {
  const out: MNote[] = []
  let s = 0
  for (const tok of src.trim().split(/\s+/)) {
    const [d, l] = tok.split('.')
    const len = Number(l)
    if (d !== 'r') out.push({ s, l: len, d: Number(d) })
    s += len
  }
  if (s !== 16) throw new Error(`la célula «${src}» no suma un compás`)
  return out
}

export interface Idea {
  name: string
  /** cabeza: el gesto que se recuerda */
  a: MNote[]
  /** cola: la respuesta, que descansa en una nota larga */
  b: MNote[]
  /** con muchas notas: su contraste natural es una idea amplia, y al revés */
  busy: boolean
}
export const idea = (name: string, a: string, b: string): Idea => {
  const head = cell(a)
  return { name, a: head, b: cell(b), busy: head.length >= 6 }
}

/**
 * Las notas fuertes (inicio de compás, valores largos) son notas del acorde o
 * apoyaturas que resuelven bajando un grado. Al estar escritas sobre la
 * fundamental, la misma idea suena en cualquier acorde: eso es una secuencia.
 */
export const COSMIC_IDEAS: Idea[] = [
  idea('lamento', '4.6 3.2 2.4 0.4', '2.8 1.4 0.4'), // quinta con puntillo y descenso
  idea('fanfarria', '0.3 0.1 2.4 4.4 7.4', '7.6 6.2 4.8'), // arpegio que sube a la octava
  idea('suspiro', '4.4 5.2 4.6 2.4', '3.4 2.8 r.4'), // bordadura de sexta menor y apoyatura 4-3
  idea('llamada', '0.4 7.6 6.2 5.4', '4.8 2.4 0.4'), // salto de octava y bajada por grados
  idea('arco', '0.4 1.4 2.4 4.4', '5.6 4.2 2.8'), // subida a negras y caída
  idea('síncopa', 'r.2 4.2 4.2 5.2 4.3 2.3 0.2', '1.3 2.3 4.6 r.4'), // empuje de 3+3+2
  idea('marcha', '4.3 4.1 4.2 4.2 5.4 4.4', '2.4 4.4 7.8'), // notas repetidas con puntillo y respuesta que sube a la octava
  idea('barroco', '0.2 2.2 4.2 2.2 5.2 4.2 2.2 4.2', '7.4 6.2 5.2 4.8'), // acorde quebrado en corcheas
  idea('cascada', '7.4 6.2 5.2 4.4 3.2 2.2', '1.4 0.4 2.8'), // escala que cae desde la octava
  idea('coral', '2.8 4.8', '5.4 4.4 2.8'), // blancas, como un coro
  idea('pregunta', '0.4 5.6 4.2 2.4', '1.4 2.4 0.8'), // salto de sexta y resolución
  idea('péndulo', '7.2 4.2 7.2 4.2 6.2 4.2 5.2 4.2', '4.8 2.8'), // la voz de arriba baja contra el pedal de la quinta
  idea('saeta', 'r.4 4.2 5.2 7.8', '6.2 5.2 4.4 2.8'), // anacrusa, nota alta sostenida y descenso adornado
  idea('eco', '4.6 3.2 2.6 1.2', '1.2 0.2 -1.4 0.8'), // dos suspiros y una bordadura bajo la raíz
  idea('tocata', '4.1 3.1 4.6 2.4 0.4', '2.1 1.1 2.6 0.8'), // mordente y arpegio que cae
  idea('ascensión', '0.2 1.2 2.2 3.2 4.2 5.2 6.2 7.2', '9.6 8.2 7.8'), // la escala entera hasta la octava
]

/** semicadencias: reposo de un compás sobre el último acorde de la frase (casi siempre la dominante) */
export const HALF: MNote[][] = ['4.4 2.4 0.8', '0.2 1.2 2.4 4.8', '2.6 1.2 0.8', '0.4 2.4 4.4 7.4', '2.4 3.2 2.2 0.8', '7.8 4.8'].map(cell)
/** esta se queda colgada de la sensible: solo si la idea arranca en la tónica, que es donde resuelve */
export const HALF_ON_LEADING = cell('4.6 3.2 2.8')
/** cadencias perfectas: compás de dominante + compás de tónica */
export const FULL: [MNote[], MNote[]][] = [
  [cell('4.4 3.4 2.8'), cell('0.12 r.4')], // re do si | do
  [cell('7.6 6.2 4.4 2.4'), cell('0.12 r.4')], // sol fa re si | do
  [cell('0.4 2.4 4.4 6.4'), cell('2.12 r.4')], // sol si re fa | mi♭
  [cell('4.8 2.6 3.2'), cell('0.12 r.4')], // re si (do) | do: con anticipación de la tónica
]

// ── de las ideas a las notas ────────────────────────────────────────────────
/** altura alrededor de la que canta el tema (Mi5), cuánto sube en el clímax y registro cómodo del lead: por encima de las cuerdas */
const LEAD_CENTER = 76
const LEAD_LIFT = 5
const LEAD_LO = 64
const LEAD_HI = 88

export interface TNote {
  step: number
  len: number
  /** grado absoluto: 0 = la tónica central, 7 = su octava */
  deg: number
  c: Deg
  vel: number
  /** ligada a la anterior (sin re-ataque) */
  slide?: boolean
  pan?: Pan
}

export const degNote = (env: Env, deg: number, mode: Mode): number => env.midTonic + MODES[mode][mod7(deg)] + 12 * Math.floor(deg / 7)

/**
 * Escribe la célula de un compás en la octava que deja su altura media más cerca de `center`,
 * sin alejarse de la nota anterior. Articulación: tras una nota corta, la siguiente va ligada
 * (si cambia de altura); el arranque de cada compás y lo que sigue a una nota larga se ataca.
 */
export function placeBar(env: Env, out: TNote[], notes: MNote[], c: Deg, bar: number, center: number, prev: number | null, vel: number): number | null {
  if (notes.length === 0) return prev
  let best = 0
  let bestCost = Infinity
  for (let k = -2; k <= 3; k++) {
    let sum = 0
    let dur = 0
    for (const n of notes) {
      sum += degNote(env, c.deg + n.d + 7 * k, c.mode) * n.l
      dur += n.l
    }
    let cost = Math.abs(sum / dur - center)
    if (prev !== null) cost += Math.abs(degNote(env, c.deg + notes[0].d + 7 * k, c.mode) - prev) * 0.25
    // fuera del registro cómodo del lead cada semitono pesa
    for (const n of notes) {
      const p = degNote(env, c.deg + n.d + 7 * k, c.mode)
      cost += Math.max(0, p - LEAD_HI, LEAD_LO - p)
    }
    if (cost < bestCost) {
      bestCost = cost
      best = k
    }
  }
  notes.forEach((n, i) => {
    const before = notes[i - 1]
    const slide = !!before && before.l <= 3 && before.s + before.l === n.s && before.d !== n.d
    out.push({ step: bar * env.spb + n.s, len: n.l, deg: c.deg + n.d + 7 * best, c, vel: n.s === 0 || n.l >= 4 ? vel : vel - 1, ...(slide ? { slide } : {}) })
  })
  return degNote(env, c.deg + notes[notes.length - 1].d + 7 * best, c.mode)
}

export interface ThemeSpec {
  x: Idea
  /** idea de contraste para el clímax */
  y: Idea
  half: MNote[][]
  full: [MNote[], MNote[]][]
  /** altura (MIDI) alrededor de la que canta el tema y cuánto sube en el clímax */
  center: number
  lift: number
  /** el clímax canta la idea de contraste en vez de la principal una octava más arriba */
  contrast: boolean
}

/**
 * Tema de `bars` compases sobre la progresión, en unidades de dos:
 * exposición · secuencia · clímax · cadencia (perfecta si la frase acaba en
 * dominante → tónica; si no, la cabeza de la idea y una semicadencia).
 */
export function buildTheme(env: Env, prog: Deg[], bars: number, t: ThemeSpec): TNote[] {
  const out: TNote[] = []
  const L = prog.length
  let prev: number | null = null
  const bar = (b: number, notes: MNote[], center: number, vel = 13): void => {
    if (b < bars) prev = placeBar(env, out, notes, prog[b % L], b, center, prev, vel)
  }
  /** ¿sonaría la unidad que empieza en `b` (con la idea principal) igual que la que abrió la frase? */
  const repeatsOpening = (b: number, center: number): boolean => {
    const probe: TNote[] = []
    const p = placeBar(env, probe, t.x.a, prog[b % L], b, center, prev, 12)
    placeBar(env, probe, t.x.b, prog[(b + 1) % L], b + 1, center, p, 12)
    const opening = out.filter((n) => n.step >= (b - 4) * env.spb && n.step < (b - 2) * env.spb)
    return opening.length === probe.length && opening.every((n, k) => degNote(env, n.deg, n.c.mode) === degNote(env, probe[k].deg, probe[k].c.mode))
  }
  for (let b = 0; b < bars; b += 2) {
    const pass = Math.floor(b / L)
    const pos = b % L
    if (pos + 2 < L) {
      // la tercera unidad de una frase de ocho compases es el clímax: sube, y si con la idea
      // principal fuera una copia del arranque (mismos acordes, misma octava), canta la de contraste.
      // En la segunda pasada de una sección larga el orden cambia: idea · contraste · idea.
      const climax = pos === 4
      const again = pass % 2 === 1
      const center = t.center + (climax ? t.lift : 0)
      let src = t.x
      if (again) src = pos === 2 ? t.y : t.x
      else if (climax && (t.contrast || repeatsOpening(b, center))) src = t.y
      bar(b, src.a, center, climax ? 14 : 13)
      bar(b + 1, src.b, center, climax ? 14 : 13)
    } else if (prog[b % L].deg === 4 && prog[(b + 1) % L].deg === 0) {
      const f = t.full[pass % t.full.length]
      bar(b, f[0], t.center + t.lift / 2, 14)
      bar(b + 1, f[1], t.center, 14)
    } else {
      bar(b, t.x.a, t.center + (L >= 8 ? t.lift / 2 : 0))
      bar(b + 1, t.half[pass % t.half.length], t.center)
    }
  }
  return out
}

export function emit(env: Env, rec: NoteRec, track: string, notes: TNote[], o: { vel?: number; oct?: number } = {}): void {
  for (const n of notes) put(rec, track, n.step, n.len, degNote(env, n.deg, n.c.mode) + 12 * (o.oct ?? 0), o.vel ?? n.vel, n)
}

/** el mismo canto a mitad de velocidad */
export const augment = (notes: TNote[]): TNote[] => notes.map((n) => ({ ...n, step: n.step * 2, len: n.len * 2 }))

/** segunda voz: una tercera diatónica por debajo; bajo la fundamental del acorde, una cuarta (su quinta) */
export const second = (notes: TNote[]): TNote[] => notes.map((n) => ({ ...n, deg: n.deg - (mod7(n.deg - n.c.deg) === 0 ? 3 : 2) }))

// ═════════════════════════════════════════════════════════════════════════════
//  Bajo
// ═════════════════════════════════════════════════════════════════════════════
/** las `n` primeras semicorcheas valen una corchea; el resto, una semicorchea */
const eighthsThen16ths = (n: number): number[] => Array.from({ length: 16 }, (_, s) => (s < n ? 2 : 1))
const onBeats = (long: number): number[] => Array.from({ length: 16 }, (_, s) => (s % 4 === 0 ? long : 1))

/**
 * Un bajo no es un compás repetido: cada dibujo tiene su compás normal (m), una variante para
 * los compases pares (v), el giro de mitad de frase que lleva al acorde siguiente (t) y el
 * cierre de frase que empuja hacia la cadencia (e). Semitonos sobre la fundamental; 96 =
 * tercera menor o quinta · 99 = fundamental del compás siguiente.
 */
interface BassStyle {
  name: string
  m: BassPat
  v: BassPat
  t: BassPat
  e: BassPat
}

const BASS_STYLES: BassStyle[] = [
  {
    name: 'octavas', // corcheas en octavas
    m: { len: 2, steps: [0, X, 12, X, 0, X, 12, X, 0, X, 12, X, 0, X, 12, X] },
    v: { len: 2, lens: eighthsThen16ths(14), steps: [0, X, 12, X, 0, X, 12, X, 0, X, 12, X, 0, X, 12, 12] },
    t: { len: 2, steps: [0, X, 12, X, 0, X, 12, X, 0, X, 12, X, 7, X, 99, X] },
    e: { len: 2, lens: eighthsThen16ths(8), steps: [0, X, 12, X, 0, X, 12, X, 0, 12, 0, 12, 0, 12, 7, 12] },
  },
  {
    name: 'rodante', // semicorcheas con la octava en el contratiempo
    m: { len: 1, steps: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 12] },
    v: { len: 1, steps: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12] },
    t: { len: 1, steps: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 7, 12, 99] },
    e: { len: 1, steps: [0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 7, 12, 0, 12, 7, 99] },
  },
  {
    name: 'galope', // larga-corta-corta
    m: { len: 1, lens: onBeats(2), steps: [0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 0, X, 12, 12] },
    v: { len: 1, lens: onBeats(2), steps: [0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 0, X, 7, 12] },
    t: { len: 1, lens: onBeats(2), steps: [0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 12, X, 7, 99] },
    e: { len: 1, lens: onBeats(2), steps: [0, X, 0, 0, 0, X, 0, 0, 0, 0, 0, 0, 12, 12, 7, 99] },
  },
  {
    name: 'motor', // raíz · raíz · quinta · octava, con anticipo del acorde siguiente
    m: { len: 1, steps: [0, 0, 7, 12, 0, 0, 7, 12, 0, 0, 7, 12, 0, 0, 7, 99] },
    v: { len: 1, steps: [0, 0, 7, 12, 0, 0, 7, 12, 0, 0, 7, 12, 0, 12, 7, 99] },
    t: { len: 1, steps: [0, 0, 7, 12, 0, 0, 7, 12, 0, 0, 7, 12, 12, 7, 96, 99] },
    e: { len: 1, steps: [0, 0, 7, 12, 0, 0, 7, 12, 0, 7, 12, 7, 12, 7, 96, 99] },
  },
]
/** pedal en corcheas sobre una sola nota (intro y puente) */
const PEDAL: BassPat = { len: 2, steps: [0, X, 0, X, 0, X, 0, X, 0, X, 0, X, 0, X, 0, X] }

const phraseEnd = (b: number, bars: number): boolean => b === bars - 1 || b % 8 === 7

/** papel de un compás dentro de la frase de ocho: normal · variante · giro de mitad de frase · cierre */
type Role = 'main' | 'alt' | 'turn' | 'end'
const roleOf = (b: number, bars: number): Role => (phraseEnd(b, bars) ? 'end' : b % 4 === 3 ? 'turn' : b % 2 === 1 ? 'alt' : 'main')

function writeBassLine(env: Env, rec: NoteRec, track: string, prog: Harm[], bars: number, st: BassStyle, o: { vel?: number; from?: number; to?: number } = {}): void {
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const role = roleOf(b, bars)
    const pat = role === 'end' ? st.e : role === 'turn' ? st.t : role === 'alt' ? st.v : st.m
    writeBass(env, rec, track, prog, bars, pat, { vel: o.vel, from: b, to: b + 1 })
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Percusión
// ═════════════════════════════════════════════════════════════════════════════
// el kit: los dos timbales ocupan el sitio de los toms y el plato el del rim
const TIMP_V = DR.TOM_LO
const TIMP_I = DR.TOM_HI
const CRASH = DR.RIM

/** redobles de timbal hacia el compás siguiente: [paso, velocidad] */
const TIMP_FILLS: [number, number][][] = [
  [[8, 9], [10, 10], [12, 11], [13, 11], [14, 12], [15, 13]],
  [[12, 10], [13, 11], [14, 12], [15, 13]],
  [[8, 10], [11, 11], [14, 13]],
  [[6, 9], [8, 10], [12, 11], [14, 12], [15, 13]],
  [[10, 10], [12, 11], [14, 12], [15, 13]],
]

/** timbal que encaja con el acorde: el de la tónica o el de la dominante, según contenga una u otra; null si ninguna */
function timp(c: Harm, prefer: 'tonic' | 'dominant'): number | null {
  const pcs = chordPcs(c)
  const hasI = pcs.includes(0)
  const hasV = pcs.includes(7)
  if (prefer === 'tonic') return hasI ? TIMP_I : hasV ? TIMP_V : null
  return hasV ? TIMP_V : hasI ? TIMP_I : null
}

/** entrada de sección: plato y timbal */
function downbeat(env: Env, rec: NoteRec, c: Harm, bar: number, vel: number): void {
  hit(rec, bar * env.spb, CRASH, vel - 2)
  const t = timp(c, 'tonic')
  if (t !== null) hit(rec, bar * env.spb, t, vel)
}

/** redoble al final de cada frase; si el acorde no admite ninguno de los dos timbales, lo hace la caja */
function timpFills(env: Env, rec: NoteRec, prog: Harm[], bars: number, fig: [number, number][]): void {
  for (let b = 0; b < bars; b++) {
    if (!phraseEnd(b, bars)) continue
    const t = timp(prog[b % prog.length], 'dominant')
    for (const [s, v] of fig) if (s < env.spb) hit(rec, b * env.spb + s, t ?? DR.SNARE, t === null ? v - 2 : v)
  }
}

type HatMode = 'none' | 'offbeat' | 'full' | '16'

interface DrumOpts {
  from?: number
  to?: number
  kick?: boolean
  kickVel?: number
  clap?: boolean
  hats?: HatMode
  shaker?: boolean
  /**
   * Batería con frase: variante en los compases pares (caja fantasma, charles desplazado), giro a
   * mitad de frase (palmas dobladas y recogida de bombo) y cierre que deja sitio al redoble de
   * timbal. Sin esto, todos los compases son iguales.
   */
  phrased?: boolean
}

/** shaker en el canal de ruido, por semicorchea del pulso: escrito para el PSG calibrado (el acento va al máximo) */
const SHAKER: Record<Role, number[]> = {
  main: [12, 6, 15, 8],
  alt: [12, 8, 15, 6],
  turn: [12, 6, 15, 8],
  end: [12, 6, 15, 8],
}
/** el último pulso del giro y del cierre crece hacia la barra */
const SHAKER_PUSH = [10, 12, 14, 15]

function discoDrums(env: Env, rec: NoteRec, bars: number, o: DrumOpts): void {
  const { spb } = env
  const to = o.to ?? bars
  const kv = o.kickVel ?? 15
  for (let b = o.from ?? 0; b < to; b++) {
    const at = b * spb
    const role: Role = o.phrased ? roleOf(b, bars) : 'main'
    if (o.kick) {
      for (let s = 0; s < spb; s += 4) hit(rec, at + s, DR.KICK, kv - (s % 8 === 4 ? 2 : s === 8 ? 1 : 0))
      // recogida antes de la barra a mitad de frase
      if (role === 'turn' && spb > 15) hit(rec, at + 15, DR.KICK, kv - 5)
    }
    if (o.clap) {
      if (spb > 4) hit(rec, at + 4, DR.CLAP, 13)
      // en el cierre de frase la palmada del 4 deja sitio al redoble; en el giro se dobla ("4-y")
      if (role !== 'end' && spb > 12) hit(rec, at + 12, DR.CLAP, 13)
      if (role === 'turn' && spb > 14) hit(rec, at + 14, DR.CLAP, 9)
      // caja fantasma: casi no se oye, pero empuja hacia el tiempo siguiente
      if (role === 'alt' && spb > 15) hit(rec, at + 15, DR.SNARE, 4)
      if (role === 'turn' && spb > 7) hit(rec, at + 7, DR.SNARE, 4)
    }
    // charles: cerrado en el pulso y abierto a contratiempo, o semicorcheas de caja de ritmos
    const hats = o.hats ?? 'none'
    for (let s = 0; s < spb; s++) {
      const q = s % 4
      if (hats === '16') {
        // en el giro, el último contratiempo se abre
        if (role === 'turn' && s === 14) hit(rec, at + s, DR.OPEN, 11)
        else hit(rec, at + s, DR.HAT, (role === 'alt' ? [10, 6, 12, 5] : [10, 5, 12, 6])[q])
      } else if (hats === 'full') {
        if (q === 0) hit(rec, at + s, DR.HAT, 8)
        else if (q === 2) hit(rec, at + s, DR.OPEN, 12)
        // en los compases pares, dos semicorcheas de más que rompen la regularidad
        else if (role === 'alt' && (s === 3 || s === 11)) hit(rec, at + s, DR.HAT, 5)
      } else if (hats === 'offbeat' && q === 2) hit(rec, at + s, DR.OPEN, 9)
      if (o.shaker) hiss(rec, at + s, NZ.HAT, (role === 'turn' || role === 'end') && s >= spb - 4 ? SHAKER_PUSH[q] : SHAKER[role][q])
    }
  }
}

/** timbales afinados: el agudo en la tónica (La2–Sol♯3) y el grave una cuarta por debajo, en la dominante */
function cosmicKit(env: Env): void {
  const tonic = 45 + mod12(env.key - 9)
  env.song.drumKit = [
    dv('KICK', 'kick', 0.45, 0.42, 0.5, 0.95),
    dv('SNARE', 'snare', 0.5, 0.42, 0.6, 0.85),
    dv('HAT', 'hat', 0.5, 0.2, 0.5, 0.7),
    dv('OPEN HAT', 'ohat', 0.5, 0.45, 0.5, 0.7),
    dv('CLAP', 'clap', 0.5, 0.5, 0.5, 0.85),
    dv('TIMPANI V', 'timp', timpPitch(tonic - 5), 0.8, 0.6, 0.8),
    dv('TIMPANI I', 'timp', timpPitch(tonic), 0.75, 0.6, 0.8),
    dv('CRASH', 'crash', 0.5, 0.7, 0.45, 0.6),
  ]
}

/** silencio general desde `end`: se quitan las notas posteriores y se recortan las que lo cruzan */
function cutAt(rec: NoteRec, end: number): void {
  for (const k of Object.keys(rec)) {
    rec[k] = rec[k].filter((n) => n.step < end)
    for (const n of rec[k]) if (n.step + n.len > end) n.len = end - n.step
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  El tema completo
// ═════════════════════════════════════════════════════════════════════════════
/** registro de las cuerdas y el coro (Re3–Do5): por debajo del tema */
const PADS = { lo: 50, hi: 72 }
/** registro del arpegio: grave bajo la melodía, agudo cuando brilla solo */
const ARP_LOW = 60
const ARP_HIGH = 72
/** frames de portamento de las notas ligadas del tema (50 ms): se nota el deslizamiento sin que cante "miau" */
const LEAD_GLIDE = 3
/**
 * Velocidades del PSG (pista a 100): el arpegio va con el acento al máximo; el eco, unos 6 dB
 * por debajo; la segunda voz, 8 dB bajo su tope. Es lo que da la consola: no hay más.
 */
const ARP_VEL = { solo: 13, under: 11, final: 12 }
const ECHO_VEL = { solo: 11, under: 9, final: 10 }
const VOICE2_VEL = 9

/** lo que se puede fijar de un tema de COSMIC DISCO en vez de dejarlo al azar */
export interface CosmicOpts {
  /** progresión de ocho compases (o su versión corta) */
  prog?: CosmicProg
  /** idea melódica del tema: es lo que se expone, se secuencia y se repite en el clímax */
  idea?: Idea
  /** idea de contraste del clímax */
  contrast?: Idea
}

function pickSpec(env: Env, o: CosmicOpts = {}): ThemeSpec {
  const { rng } = env
  // los sorteos se hacen igual con y sin opciones: el resto del tema no cambia por fijar una idea
  const x0 = rng.pick(COSMIC_IDEAS)
  const x = o.idea ?? x0
  const y0 = rng.pick(COSMIC_IDEAS.filter((q) => q.busy !== x.busy))
  const y = o.contrast ?? y0
  const halves = mod7(x.a[0].d) === 0 ? [...HALF, HALF_ON_LEADING] : HALF
  const h1 = rng.pick(halves)
  const h2 = rng.pick(halves.filter((q) => q !== h1))
  const f1 = rng.pick(FULL)
  // la segunda pasada cierra siempre sobre la tónica en la melodía
  const f2 = rng.pick(FULL.filter((q) => q !== f1 && q[1][0].d === 0))
  return { x, y, half: [h1, h2], full: [f1, f2 ?? f1], center: LEAD_CENTER, lift: LEAD_LIFT, contrast: rng.chance(0.5) }
}

/** tres elementos distintos de una lista, en orden aleatorio */
function pick3<T>(env: Env, from: readonly T[]): [T, T, T] {
  const pool = [...from]
  const take = (): T => pool.splice(Math.floor(env.rng.next() * pool.length), 1)[0]
  return [take(), take(), take()]
}

export function genCosmic(env: Env, bars: number, o: CosmicOpts = {}): void {
  const { rng, song, spb } = env
  setScale(env, 'minor')
  const picked = rng.pick(COSMIC_PROGS)
  const pd = o.prog ?? picked
  const prog = bars < 8 ? pd.short : pd.full
  const L = prog.length
  song.title = song.title.replace('COSMIC DISCO', `COSMIC ${pd.name}`)

  const spec = pickSpec(env, o)
  const theme = buildTheme(env, prog, bars, spec)
  const bassA = rng.pick(BASS_STYLES)
  // el final siempre en semicorcheas y con otro dibujo
  const bassB = rng.pick(BASS_STYLES.filter((p) => p !== bassA && p.m.len === 1))
  const shape = rng.pick(ARP_SHAPES)
  const shapeB = rng.pick(ARP_SHAPES.filter((s) => s !== shape))
  const rate: 1 | 2 = rng.chance(0.75) ? 1 : 2
  const hats: HatMode = rng.chance(0.6) ? 'full' : '16'
  // cada sección cierra sus frases con un redoble distinto
  const [fillA, fillB, fillF] = pick3(env, TIMP_FILLS)
  const overture = rng.chance(0.5)
  const duet = rng.chance(0.7)
  const breath = rng.chance(0.4)
  const total = bars * spb
  const half = Math.floor(bars / 2)
  const last = bars - 1

  // puente y obertura: la primera mitad de la progresión al doble de lento, acabando en la dominante
  const slowChords = prog.slice(0, Math.max(1, half))
  if (slowChords.length > 1) slowChords[slowChords.length - 1] = CH.V7
  const slowProg = slowChords.flatMap((c) => [c, c])
  const slowTheme = augment(buildTheme(env, slowChords, slowChords.length, spec))

  // coda: la progresión desemboca en dominante y tónica
  const outProg = Array.from({ length: bars }, (_, b) => prog[b % L])
  outProg[last] = CH.i
  if (bars > 1) outProg[last - 1] = CH.V7

  // al final de A la voz principal se asoma: la cabeza del tema a un lado y su eco al otro,
  // sobre los dos últimos acordes, antes de que B lo exponga entero y en el centro
  const leadIn: TNote[] = []
  if (bars >= 4) {
    const p = placeBar(env, leadIn, spec.x.a, prog[(last - 1) % L], last - 1, LEAD_CENTER, null, 11)
    placeBar(env, leadIn, spec.x.a, prog[last % L], last, LEAD_CENTER, p, 11)
    for (const n of leadIn) n.pan = n.step < last * spb ? 'L' : 'R'
  }

  cosmicKit(env)
  setupTracks(song, {
    fm1: { inst: FM.SEQ_BASS, name: 'BASS', vol: 92, pan: 'C', gate: 0.66 },
    fm2: { inst: FM.SOLINA, name: 'STRINGS L', vol: 72, pan: 'L', gate: 0.98 },
    fm3: { inst: FM.SOLINA, name: 'STRINGS R', vol: 72, pan: 'R', gate: 0.98 },
    fm4: { inst: FM.COSMIC_LEAD, name: 'LEAD', vol: 90, pan: 'C', glide: LEAD_GLIDE },
    fm5: { inst: FM.CHOIR, name: 'CHOIR', vol: 36, pan: 'C', gate: 0.98 },
    ch6: { name: 'DRUMS', vol: 100, pan: 'C' },
    sq1: { inst: PSG.PLUCK_HI, name: 'ARP', vol: 100 },
    sq2: { inst: PSG.PLUCK, name: 'ECHO', vol: 100 },
    sq3: { inst: PSG.LEAD, name: 'VOZ 2', vol: 100, glide: LEAD_GLIDE },
    noise: { name: 'SHAKER', vol: 100 },
  })

  const arp = (rec: NoteRec, p: Harm[], sh: number[], vel: number, o: { base?: number; rate?: 1 | 2; from?: number; to?: number } = {}): void => {
    writeArp(env, rec, 'sq1', p, bars, { shape: sh, rate: o.rate ?? rate, base: o.base ?? ARP_LOW, vel, from: o.from, to: o.to })
  }
  const echo = (rec: NoteRec, vel: number): void => writeEcho(rec, 'sq1', 'sq2', 3, vel, total)

  addSection(song, 'INTRO', bars, 1, (rec) => {
    if (overture) {
      // obertura: armonía lenta y una voz lejana que anuncia el tema a mitad de velocidad
      writePads(env, rec, slowProg, bars, { vel: 10, ...PADS })
      emit(env, rec, 'sq3', slowTheme.filter((n) => n.step < half * spb), { vel: 11 })
      arp(rec, slowProg, shape, ARP_VEL.solo, { base: ARP_HIGH, from: half })
    } else {
      // pedal de tónica en corcheas bajo los acordes: la tensión antes de que arranque el ritmo
      writePads(env, rec, prog, bars, { vel: 10, ...PADS })
      writeBass(env, rec, 'fm1', [CH.i], bars, PEDAL, { vel: 10 })
      arp(rec, prog, shape, ARP_VEL.solo, { base: ARP_HIGH, from: half })
    }
    echo(rec, ECHO_VEL.solo)
    discoDrums(env, rec, bars, { from: half, kick: true, kickVel: 12, hats: 'offbeat' })
    downbeat(env, rec, CH.i, 0, 11)
    // último compás: redoble de timbal (o de caja) y subida de ruido
    const c = (overture ? slowProg : prog)[last % (overture ? slowProg.length : L)]
    roll(rec, last * spb + 8, total, timp(c, 'dominant') ?? DR.SNARE, 5, 12)
    riser(rec, last * spb, total, 6, 15)
  })

  addSection(song, 'A', bars, 1, (rec) => {
    discoDrums(env, rec, bars, { kick: true, clap: true, hats, shaker: true, phrased: true })
    downbeat(env, rec, prog[0], 0, 13)
    timpFills(env, rec, prog, bars, fillA)
    writeBassLine(env, rec, 'fm1', prog, bars, bassA)
    // el arpegio es la voz de esta sección: las cuerdas se quedan un punto atrás (en el PSG no hay más nivel)
    writePads(env, rec, prog, bars, { vel: 10, ...PADS })
    arp(rec, prog, shape, ARP_VEL.solo)
    echo(rec, ECHO_VEL.solo)
    emit(env, rec, 'fm4', leadIn)
  })

  addSection(song, 'B', bars, 2, (rec) => {
    discoDrums(env, rec, bars, { kick: true, clap: true, hats, shaker: true, phrased: true })
    downbeat(env, rec, prog[0], 0, 13)
    timpFills(env, rec, prog, bars, fillB)
    writeBassLine(env, rec, 'fm1', prog, bars, bassA)
    writePads(env, rec, prog, bars, { vel: 12, ...PADS })
    arp(rec, prog, shape, ARP_VEL.under)
    echo(rec, ECHO_VEL.under)
    emit(env, rec, 'fm4', theme)
  })

  addSection(song, 'BRK', bars, 1, (rec) => {
    writePads(env, rec, slowProg, bars, { vel: 12, ...PADS })
    arp(rec, slowProg, shapeB, ARP_VEL.under, { base: ARP_HIGH, rate: 2 })
    echo(rec, ECHO_VEL.final)
    emit(env, rec, 'fm4', slowTheme)
    // el timbal marca cada acorde nuevo; el plato, la entrada
    hit(rec, 0, CRASH, 10)
    for (let b = 0; b < last; b += 2) {
      const t = timp(slowProg[b % slowProg.length], 'tonic')
      if (t !== null) hit(rec, b * spb, t, 10)
    }
    // segunda mitad: vuelve el bombo y el bajo se planta en la dominante
    discoDrums(env, rec, bars, { from: half, kick: true, kickVel: 12, hats: 'offbeat' })
    writeBass(env, rec, 'fm1', [CH.V], bars, PEDAL, { from: Math.max(half, bars - 2), vel: 11 })
    // último compás: redoble de caja, timbal a negras y subida
    roll(rec, last * spb, total, DR.SNARE, 3, 13)
    for (let s = 0; s < spb; s += 4) hit(rec, last * spb + s, TIMP_V, 9 + s / 4)
    riser(rec, last * spb, total, 6, 15)
    // a veces, una negra de silencio antes del golpe del final
    if (breath) cutAt(rec, total - 4)
  })

  addSection(song, 'FINAL', bars, 2, (rec) => {
    discoDrums(env, rec, bars, { kick: true, clap: true, hats: '16', shaker: true, phrased: true })
    downbeat(env, rec, prog[0], 0, 14)
    for (let b = 4; b < bars; b += 4) {
      const t = timp(prog[b % L], 'tonic')
      if (t !== null) hit(rec, b * spb, t, 12)
    }
    timpFills(env, rec, prog, bars, fillF)
    writeBassLine(env, rec, 'fm1', prog, bars, bassB)
    writePads(env, rec, prog, bars, { vel: 13, ...PADS })
    arp(rec, prog, shapeB, ARP_VEL.final)
    echo(rec, ECHO_VEL.final)
    emit(env, rec, 'fm4', theme)
    // el tema a dos voces: en terceras, o doblado a la octava grave
    if (duet) emit(env, rec, 'sq3', second(theme), { vel: VOICE2_VEL })
    else emit(env, rec, 'sq3', theme, { vel: VOICE2_VEL, oct: -1 })
  })

  addSection(song, 'OUTRO', bars, 1, (rec) => {
    const out = Math.max(1, bars - 2)
    discoDrums(env, rec, bars, { to: out, kick: true, hats: 'offbeat' })
    downbeat(env, rec, outProg[0], 0, 12)
    writeBassLine(env, rec, 'fm1', outProg, bars, bassA, { to: out, vel: 11 })
    writePads(env, rec, outProg, bars, { vel: 11, ...PADS })
    arp(rec, outProg, shape, ARP_VEL.final, { to: last })
    echo(rec, ECHO_VEL.final)
    // el tema se despide con su primera frase
    if (bars > 4) emit(env, rec, 'fm4', theme.filter((n) => n.step < 2 * spb), { vel: 12 })
    if (bars > 1) {
      // cadencia final: dominante con redoble de timbal…
      put(rec, 'fm1', (last - 1) * spb, 8, bassRoot(env, CH.V), 12)
      roll(rec, (last - 1) * spb + 8, last * spb, TIMP_V, 5, 12)
    }
    // …y la tónica, con el golpe definitivo
    hit(rec, last * spb, CRASH, 13)
    hit(rec, last * spb, TIMP_I, 14)
    hit(rec, last * spb, DR.KICK, 14)
    put(rec, 'fm1', last * spb, 8, bassRoot(env, CH.i), 13)
    put(rec, 'fm4', last * spb, 12, env.midTonic + 12, 12)
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  Rellenar una pista
// ═════════════════════════════════════════════════════════════════════════════
const FALLBACK_RHYTHMS: [number, number][][] = [
  [[0, 6], [6, 2], [8, 4], [12, 4], [16, 8], [24, 4], [28, 4]],
  [[0, 4], [4, 4], [8, 6], [14, 2], [16, 12], [28, 4]],
  [[0, 8], [8, 4], [12, 4], [16, 6], [22, 2], [24, 8]],
]

/**
 * Notas nuevas para una pista con el lenguaje del estilo. Escribe en `rec` y
 * devuelve de qué pista de `rec` hay que tomarlas. El tema por ideas necesita
 * 4/4 y escala menor (natural o armónica); en otro caso se usan los grados de
 * la escala de la canción y una melodía por pasos.
 */
export function cosmicFill(env: Env, rec: NoteRec, trackId: string, kind: FillKind, bars: number, onNoise: boolean): string {
  const { rng, song, spb } = env
  const curated = spb === 16 && (song.scale === 'minor' || song.scale === 'harmonicMinor')
  const pd = rng.pick(COSMIC_PROGS)
  const degs = bars < 8 ? pd.short : pd.full
  const prog: Harm[] = curated
    ? degs
    : [0, 4, 5, 3].map((d) => {
        const c = diatonicChord(d, 0, song.scale, 60)
        return { root: mod12(c.root - 60), type: c.type }
      })

  switch (kind) {
    case 'bass':
      writeBassLine(env, rec, trackId, prog, bars, rng.pick(BASS_STYLES))
      return trackId
    case 'chords': {
      // el acorde entero en una sola pista: el chip lo arpegia
      let prev: number[] | null = null
      for (let b = 0; b < bars; b++) {
        const v = padVoices(env, prev, prog[b % prog.length], PADS.lo, PADS.hi)
        for (const n of v) put(rec, trackId, b * spb, spb, n, 10)
        prev = v
      }
      return trackId
    }
    case 'arp':
      writeArp(env, rec, trackId, prog, bars, { shape: rng.pick(ARP_SHAPES), rate: rng.chance(0.75) ? 1 : 2, base: rng.chance(0.5) ? ARP_LOW : ARP_HIGH, vel: ARP_VEL.solo })
      return trackId
    case 'lead':
      if (curated) emit(env, rec, trackId, buildTheme(env, degs, bars, pickSpec(env)))
      else writeMelody(env, rec, { track: trackId, lo: env.midTonic + 7, hi: env.midTonic + 26, rhythms: FALLBACK_RHYTHMS, moves: [14, 26, 26, 12, 12, 4, 4, 1, 1], vel: 13 }, prog, bars)
      return trackId
    case 'drums':
      // el ritmo va en ch6 (bombo, palmas, charles, timbales) y en el ruido (shaker)
      discoDrums(env, rec, bars, { kick: true, clap: true, hats: rng.chance(0.6) ? 'full' : '16', shaker: true, phrased: true })
      downbeat(env, rec, prog[0], 0, 13)
      timpFills(env, rec, prog, bars, rng.pick(TIMP_FILLS))
      return onNoise ? 'noise' : 'ch6'
    default:
      if (onNoise) {
        discoDrums(env, rec, bars, { shaker: true, phrased: true })
        return 'noise'
      }
      // percusión de orquesta: plato en la entrada, timbal al caer cada frase y redoble al final
      downbeat(env, rec, prog[0], 0, 13)
      for (let b = 2; b < bars; b += 2) {
        const t = timp(prog[b % prog.length], 'tonic')
        if (t !== null) hit(rec, b * spb, t, 11)
      }
      timpFills(env, rec, prog, bars, rng.pick(TIMP_FILLS))
      return 'ch6'
  }
}
