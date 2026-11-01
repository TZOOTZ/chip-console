// ── JAZZ FUSION y JAZZ SWING ─────────────────────────────────────────────────
//
// Jazz de consola: el que firmaban los compositores de Sega con seis canales de FM, tres de onda
// cuadrada y una batería muestreada (Galaxy Force II, Thunder Blade, Thunder Force…).
//
//   fusion  corcheas rectas con semicorcheas de funk: vamp dórico o menor con II–V, bajo slap,
//           teclado eléctrico a tres voces, saxo y batería de rock ligero. 100–126 BPM
//   swing   corchea con swing (2:1: `swingGrid` 4 y 33 %), bajo andante, guitarra de Freddie Green, rides y
//           escobillas, II–V–I con dominantes alteradas. Tempo de negra de verdad (132–168 BPM). Se compone
//           en pasos de corchea (compases de 8 pasos) y al escribir cada paso pasa a ocupar dos semicorcheas
//
// Las voces del teclado van en tres canales FM (una nota por canal: sin arpegios a 60 Hz): tercera,
// séptima y una extensión, con la conducción de voces más cercana de un acorde al siguiente.
import { addSection, dv, makeEnv, setupTracks, writeEcho, type Env } from './electrokit'
import { DR, FM, NZ, PSG, Rng, put, type FillKind, type NoteRec } from './genkit'
import type { DrumVoice, Note, Pattern, Song } from './song'
import { patternSteps } from './song'

export type JazzStyle = 'fusion' | 'swing'
export const isJazz = (s: string): s is JazzStyle => s === 'fusion' || s === 'swing'
export const JAZZ_BPM: Record<JazzStyle, [number, number]> = { fusion: [100, 126], swing: [132, 168] }

// ── armonía ─────────────────────────────────────────────────────────────────
type Q = 'maj7' | 'm7' | 'm9' | '7' | '9' | 'alt' | 'm7b5'
interface JC {
  /** semitonos sobre la tónica */
  root: number
  q: Q
  /** paso de inicio dentro del compás y duración */
  at: number
  len: number
}

/** terceras, quintas, séptimas y extensiones (semitonos sobre la fundamental) */
const TONES: Record<Q, { third: number; fifth: number; seventh: number; color: number[] }> = {
  maj7: { third: 4, fifth: 7, seventh: 11, color: [14, 21] },
  m7: { third: 3, fifth: 7, seventh: 10, color: [14, 17] },
  m9: { third: 3, fifth: 7, seventh: 10, color: [14, 17] },
  '7': { third: 4, fifth: 7, seventh: 10, color: [14, 21] },
  '9': { third: 4, fifth: 7, seventh: 10, color: [14, 21] },
  alt: { third: 4, fifth: 6, seventh: 10, color: [13, 15, 20] },
  m7b5: { third: 3, fifth: 6, seventh: 10, color: [17, 20] },
}

/** la escala del acorde: de ahí salen las notas de paso de la melodía */
function chordScale(c: JC): number[] {
  switch (c.q) {
    case 'maj7':
      return c.root === 5 ? [0, 2, 4, 6, 7, 9, 11] : [0, 2, 4, 5, 7, 9, 11]
    case 'm7':
    case 'm9':
      return [0, 2, 3, 5, 7, 9, 10]
    case '7':
    case '9':
      return [0, 2, 4, 5, 7, 9, 10]
    case 'alt':
      return [0, 1, 3, 4, 6, 8, 10]
    default:
      return [0, 2, 3, 5, 6, 8, 10]
  }
}

/** compás a compás: "raíz:tipo" o dos acordes "raíz:tipo,raíz:tipo" (mitad y mitad) */
const PROGS: Record<JazzStyle, string[][]> = {
  swing: [
    // cambios de ritmo: I VI7 | ii V7 | iii VI7alt | ii V7 | I I7 | IV #ivø | iii VI7alt | ii V7alt
    ['0:maj7,9:7', '2:m7,7:7', '4:m7,9:alt', '2:m7,7:7', '0:maj7,0:7', '5:maj7,6:m7b5', '4:m7,9:alt', '2:m7,7:alt'],
    // hojas de otoño: ii | V7 | I | IV | viiø | III7alt | vi | vi
    ['2:m7', '7:7', '0:maj7', '5:maj7', '11:m7b5', '4:alt', '9:m7', '9:m7'],
    // el tren A: I | I | II7 | II7 | ii | V7 | I vi | ii V7alt
    ['0:maj7', '0:maj7', '2:7', '2:7', '2:m7', '7:7', '0:maj7,9:m7', '2:m7,7:alt'],
  ],
  fusion: [
    // vamp dórico con IV9 y el bVII; termina en la dominante alterada que tira al bucle
    ['0:m9', '5:9', '0:m9', '5:9', '3:maj7', '10:9', '0:m9', '7:alt'],
    // círculo menor: i | iv | bVII7 | bIII | bVI | iiø | V7alt | i
    ['0:m7', '5:m7', '10:9', '3:maj7', '8:maj7', '2:m7b5', '7:alt', '0:m9'],
    ['0:m9', '5:9', '10:9', '3:maj7', '0:m9', '5:9', '2:m7b5,7:alt', '0:m9,7:alt'],
  ],
}

/** progresión de `count` compases (se cicla; con menos de 8 se conservan los II–V del final) */
function progBars(specs: string[], count: number, spb: number, shift = 0): JC[][] {
  const order = count >= 8 ? specs.map((_, i) => i) : [0, 1, 2, 7, 3, 4, 5, 6]
  const out: JC[][] = []
  for (let b = 0; b < count; b++) {
    const spec = specs[count >= 8 ? b % specs.length : order[b]]
    const parts = spec.split(',')
    const len = spb / parts.length
    out.push(
      parts.map((p, i) => {
        const [r, q] = p.split(':')
        return { root: (Number(r) + shift + 12) % 12, q: q as Q, at: i * len, len }
      }),
    )
  }
  return out
}

/** compases de una progresión con el último acorde cambiado por la dominante (puente que vuelve a casa) */
function toDominant(bars: JC[][]): JC[][] {
  const out = bars.map((b) => b.map((c) => ({ ...c })))
  const last = out[out.length - 1]
  out[out.length - 1] = [{ root: 7, q: 'alt', at: 0, len: last.reduce((n, c) => n + c.len, 0) }]
  return out
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12

// ── teclado: tres voces con la conducción más cercana ───────────────────────
function voicing(env: Env, c: JC, prev: number[] | null, rng: Rng): number[] {
  const t = TONES[c.q]
  const col = t.color[rng.int(0, t.color.length - 1)]
  const pcs = [t.third, t.seventh, col].map((iv) => mod12(env.key + c.root + iv))
  const lists = pcs.map((pc) => {
    const out: number[] = []
    for (let m = 52; m <= 76; m++) if (mod12(m) === pc) out.push(m)
    return out
  })
  let best: number[] = []
  let bestCost = Infinity
  for (const a of lists[0])
    for (const b of lists[1])
      for (const d of lists[2]) {
        const v = [a, b, d].sort((x, y) => x - y)
        if (v[0] === v[1] || v[1] === v[2]) continue
        const span = v[2] - v[0]
        let cost = span > 11 ? (span - 11) * 3 : 0
        cost += prev ? Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2]) : Math.abs(v[1] - 64)
        cost += rng.next() * 0.5
        if (cost < bestCost) {
          bestCost = cost
          best = v
        }
      }
  return best
}

/** figuras del teclado por duración del acorde en pasos ("paso:longitud") */
const COMP: Record<JazzStyle, Record<number, string[]>> = {
  swing: {
    8: ['0:3,3:2', '2:2,6:2', '0:2,3:1,5:1,7:1', '3:2,7:1', '0:1,3:2,6:2'],
    4: ['0:3', '0:2,3:1', '1:2', '0:1,3:1'],
  },
  fusion: {
    16: ['0:2,3:1,6:2,10:1,13:2', '2:1,3:1,6:1,10:2,11:1,14:2', '0:1,3:1,4:2,7:1,10:1,12:2', '0:6,6:2,8:2,12:2', '1:1,3:2,6:1,9:2,11:1,14:2'],
    8: ['0:2,3:1,6:2', '0:1,3:2,5:1', '2:2,5:1', '0:4'],
  },
}

const cellsOfStr = (spec: string): [number, number][] =>
  spec.split(',').map((x) => {
    const [s, l] = x.split(':').map(Number)
    return [s, l]
  })

const COMP_TRACKS = ['fm2', 'fm3', 'fm5']

/** la voz más grave en FM2, la de en medio en FM3 y la aguda en FM5 */
function writeComp(env: Env, rec: NoteRec, feel: JazzStyle, bars: JC[][], rng: Rng, vel: number, sparse = false): void {
  const { spb } = env
  const beat = feel === 'swing' ? 2 : 4
  let prev: number[] | null = null
  let fig = rng.int(0, 4)
  for (let b = 0; b < bars.length; b++) {
    // la figura se mantiene dos compases: repetir exacto y variar poco
    if (b % 2 === 0) fig = rng.int(0, 4)
    for (const seg of bars[b]) {
      const v = voicing(env, seg, prev, rng)
      prev = v
      const pool = COMP[feel][seg.len] ?? COMP[feel][spb]
      let cells = cellsOfStr(pool[fig % pool.length])
      // con poco que decir: solo el primer golpe de cada acorde
      if (sparse) cells = cells.slice(0, 1)
      for (const [s, l] of cells) {
        const at = b * spb + seg.at + s
        const vv = vel + (s % beat === 0 ? 1 : -1)
        for (let i = 0; i < 3; i++) put(rec, COMP_TRACKS[i], at, l, v[i], vv)
      }
    }
  }
}

// ── bajo ────────────────────────────────────────────────────────────────────
/** fundamental en el registro de bajo (Sol1–Mi3) */
const fitBass = (n: number): number => {
  let m = n
  while (m > 52) m -= 12
  while (m < 31) m += 12
  return m
}
const bassAt = (env: Env, root: number): number => fitBass(env.bassTonic + root)

interface Seg {
  b: number
  c: JC
}
const flatten = (bars: JC[][]): Seg[] => bars.flatMap((cs, b) => cs.map((c) => ({ b, c })))

/** nota de aproximación cromática al acorde siguiente (por debajo casi siempre) */
function approach(env: Env, next: JC, from: number, rng: Rng): number {
  const nr = bassAt(env, next.root)
  const below = nr - 1
  const above = nr + 1
  if (rng.chance(0.25)) return above
  return Math.abs(below - from) <= Math.abs(above - from) + 2 ? below : above
}

/**
 * Bajo andante: una negra por pulso. La fundamental cae en el registro más cercano a donde iba la línea, los
 * pulsos de en medio son notas del acorde que van hacia la siguiente fundamental (con un arco aleatorio) y el
 * último es una aproximación cromática a ella. Sin saltos grandes ni dos notas iguales seguidas.
 */
function walkBass(env: Env, rec: NoteRec, track: string, bars: JC[][], rng: Rng, vel: number): void {
  const { spb } = env
  const segs = flatten(bars)
  const first = bassAt(env, segs[0].c.root)
  // la fundamental de cada acorde va en el registro que hace el recorrido más corto, y el último enlaza con el
  // primero (por donde vuelve el bucle): programación dinámica sobre las octavas posibles de cada fundamental
  const choices = segs.map(({ c }, i) => {
    if (i === 0) return [first]
    const pc = mod12(env.key + c.root)
    const o: number[] = []
    for (let n = 31; n <= 52; n++) if (mod12(n) === pc) o.push(n)
    return o
  })
  const best: { cost: number; from: number }[][] = []
  choices.forEach((opts, i) => {
    best.push(
      opts.map((n) => {
        if (i === 0) return { cost: 0, from: -1 }
        let cost = Infinity
        let from = 0
        choices[i - 1].forEach((m, k) => {
          const v = best[i - 1][k].cost + Math.abs(n - m)
          if (v < cost) {
            cost = v
            from = k
          }
        })
        return { cost: cost + 0.15 * Math.abs(n - 41), from }
      }),
    )
  })
  let pick0 = 0
  let total = Infinity
  choices[choices.length - 1].forEach((n, k) => {
    const v = best[best.length - 1][k].cost + Math.abs(n - first)
    if (v < total) {
      total = v
      pick0 = k
    }
  })
  const roots: number[] = []
  for (let i = choices.length - 1; i >= 0; i--) {
    roots[i] = choices[i][pick0]
    pick0 = best[i][pick0].from
  }
  segs.forEach(({ b, c }, i) => {
    const t = TONES[c.q]
    const root = roots[i]
    const nextRoot = roots[(i + 1) % segs.length]
    const p = [root]
    const pick = (target: number): number => {
      const cands: number[] = []
      for (const iv of [0, t.third, t.fifth, t.seventh]) {
        for (let k = -2; k <= 2; k++) {
          const n = root + iv + 12 * k
          if (n >= 31 && n <= 52 && !p.includes(n)) cands.push(n)
        }
      }
      // sin saltos de más de una sexta desde la nota anterior, si hay donde elegir
      const prev = p[p.length - 1]
      const close = cands.filter((n) => Math.abs(n - prev) <= 8)
      const pool = close.length ? close : cands
      pool.sort((x, y) => Math.abs(x - target) - Math.abs(y - target))
      return pool[rng.chance(0.7) ? 0 : Math.min(1, pool.length - 1)]
    }
    if (c.len / 2 === 4) {
      const arc = rng.pick([-5, 0, 0, 5, 7])
      p.push(pick(root + (nextRoot - root) / 3 + arc))
      p.push(pick(root + (2 * (nextRoot - root)) / 3 + arc / 2))
    }
    const last = p[p.length - 1]
    const below = nextRoot - 1
    const above = nextRoot + 1
    let ap = Math.abs(below - last) <= Math.abs(above - last) ? below : above
    if (rng.chance(0.2)) ap = ap === below ? above : below
    if (ap === last) ap = ap === below ? above : below
    p.push(ap)
    p.forEach((n, k) => put(rec, track, b * spb + c.at + k * 2, 2, n, k === 0 ? vel + 1 : vel))
  })
}

/** figuras del bajo slap: paso:longitud:código (0 fundamental · 12 octava · 7 quinta · 97 séptima · 98 tercera · 99 aproximación) */
const SLAP: string[] = [
  '0:2:0,3:1:0,5:1:12,6:2:0,8:2:0,11:1:7,13:1:97,14:2:99',
  '0:3:0,3:1:12,4:2:0,7:1:0,8:2:7,10:2:0,12:1:98,14:1:97,15:1:99',
  '0:1:0,2:1:0,3:1:12,6:2:7,8:1:0,10:2:0,11:1:12,14:2:99',
  '0:4:0,6:1:0,7:1:12,8:4:0,14:1:97,15:1:99',
]

function slapBass(env: Env, rec: NoteRec, track: string, bars: JC[][], rng: Rng, vel: number): void {
  const { spb } = env
  const segs = flatten(bars)
  let fig = rng.int(0, SLAP.length - 1)
  segs.forEach(({ b, c }, i) => {
    if (c.at === 0 && b % 2 === 0) fig = rng.int(0, SLAP.length - 1)
    const next = segs[(i + 1) % segs.length].c
    const t = TONES[c.q]
    const root = bassAt(env, c.root)
    const cells = SLAP[fig].split(',').map((x) => x.split(':').map(Number))
    const kept = cells.filter((x) => x[0] < c.len)
    // en un acorde corto, la última nota lleva al siguiente
    if (c.len < spb && kept.length) kept[kept.length - 1][2] = 99
    for (const [s, l, code] of kept) {
      let n = root
      if (code === 12) n = fitBass(root + 12)
      else if (code === 7) n = fitBass(root + t.fifth)
      else if (code === 97) n = fitBass(root + t.seventh)
      else if (code === 98) n = fitBass(root + t.third)
      else if (code === 99) n = approach(env, next, root, rng)
      put(rec, track, b * spb + c.at + s, l, n, s % 4 === 0 ? vel + 1 : vel)
    }
  })
}

// ── melodía: frases de cuatro compases con notas de acorde en los apoyos ─────
const LINE_CELLS: Record<JazzStyle, { head: string[]; solo: string[]; end: string }> = {
  swing: {
    head: ['0:2,2:1,3:1,4:4', '1:1,2:1,3:2,5:1,6:2', '0:3,3:1,4:2,6:2', '2:2,4:1,5:1,6:2'],
    solo: ['0:1,1:1,2:1,3:1,4:1,5:1,6:1,7:1', '0:1,1:1,2:1,3:1,4:2,6:1,7:1', '1:1,2:1,3:1,4:1,5:1,6:1,7:1', '0:2,2:1,3:1,4:1,5:1,6:1,7:1'],
    end: '0:1,1:1,2:2,4:4',
  },
  fusion: {
    head: ['0:3,3:1,4:2,6:2,8:4,12:3', '2:2,4:1,5:1,6:2,8:2,10:2,12:4', '0:2,2:1,3:1,4:2,6:2,8:2,10:1,11:1,12:4', '4:2,6:2,8:3,11:1,12:2,14:2'],
    solo: [
      '0:1,1:1,2:1,3:1,4:2,6:1,7:1,8:1,9:1,10:2,12:1,13:1,14:2',
      '0:2,2:1,3:1,4:1,5:1,6:2,8:2,10:1,11:1,12:1,13:1,14:2',
      '1:1,2:1,3:1,4:1,5:1,6:1,7:1,8:2,10:2,12:1,13:1,14:1,15:1',
    ],
    end: '0:2,2:1,3:1,4:2,6:2,8:8',
  },
}

interface Ev {
  step: number
  len: number
  strong: boolean
  note: number
}

function chordAt(bars: JC[][], spb: number, step: number): JC {
  const bar = bars[Math.min(bars.length - 1, Math.floor(step / spb))]
  const at = step % spb
  return bar.find((c) => at >= c.at && at < c.at + c.len) ?? bar[0]
}

const nearestIdx = (arr: number[], x: number): number => {
  let k = 0
  for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - x) < Math.abs(arr[k] - x)) k = i
  return k
}

/** notas MIDI dentro de [lo, hi] que pertenecen a las clases de altura dadas */
function within(lo: number, hi: number, pcs: number[]): number[] {
  const out: number[] = []
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m)
  return out
}

/** registro del saxo: de la A2 grave a la nota más alta cómoda */
export const leadRange = (feel: JazzStyle): [number, number] => (feel === 'swing' ? [57, 79] : [58, 81])

interface LineOpts {
  lo: number
  hi: number
  /** corcheas seguidas (solo) o figuras con aire (tema) */
  dense: boolean
  /** probabilidad de dejar un compás en silencio (menos el primero y el último de cada frase) */
  rest: number
}

/**
 * Una línea de jazz sobre los acordes: frases de cuatro compases (A A B final) donde los apoyos son
 * notas del acorde, entre apoyos se camina por la escala del acorde y a veces se llega a la nota
 * por aproximación cromática. Cada frase acaba en una nota larga.
 */
function jazzLine(env: Env, feel: JazzStyle, bars: JC[][], rng: Rng, o: LineOpts): Ev[] {
  const { spb } = env
  const beat = feel === 'swing' ? 2 : 4
  const cells = LINE_CELLS[feel]
  const pool = o.dense ? cells.solo : cells.head
  const ev: Ev[] = []
  let a = rng.pick(pool)
  let b = rng.pick(pool)
  for (let bar = 0; bar < bars.length; bar++) {
    const ph = bar % 4
    if (ph === 0 && bar > 0 && rng.chance(0.4)) {
      a = rng.pick(pool)
      b = rng.pick(pool)
    }
    if (ph !== 0 && ph !== 3 && o.rest > 0 && rng.chance(o.rest)) continue
    const spec = ph === 3 ? cells.end : ph === 2 ? b : a
    for (const [s, l] of cellsOfStr(spec)) ev.push({ step: bar * spb + s, len: l, strong: s % beat === 0 || l >= 2, note: 0 })
  }
  const tones = (c: JC): number[] => {
    const t = TONES[c.q]
    return within(o.lo, o.hi, [0, t.third, t.fifth, t.seventh, t.color[0]].map((iv) => mod12(env.key + c.root + iv)))
  }
  const scale = (c: JC): number[] => within(o.lo, o.hi, chordScale(c).map((iv) => mod12(env.key + c.root + iv)))
  const mid = Math.round((o.lo + o.hi) / 2)
  // apoyos: la nota del acorde más cercana a un salto corto en la dirección del contorno
  let prev = mid
  let dir = 1
  let lastBar = -1
  for (const e of ev) {
    if (!e.strong) continue
    const bar = Math.floor(e.step / spb)
    if (bar !== lastBar) {
      if (rng.chance(0.55)) dir = -dir
      lastBar = bar
    }
    if (prev > o.hi - 3) dir = -1
    else if (prev < o.lo + 3) dir = 1
    const ct = tones(chordAt(bars, spb, e.step))
    const want = prev + dir * rng.int(1, 5)
    let pick = ct[nearestIdx(ct, want)]
    if (pick === prev && ct.length > 1) pick = ct[Math.max(0, Math.min(ct.length - 1, nearestIdx(ct, prev) + dir))]
    e.note = pick
    prev = pick
  }
  // entre apoyos: por la escala hacia el siguiente apoyo, o aproximación cromática a él
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].strong) continue
    const sc = scale(chordAt(bars, spb, ev[i].step))
    const before = i > 0 ? ev[i - 1].note : mid
    let j = i + 1
    while (j < ev.length && !ev[j].strong) j++
    const target = j < ev.length ? ev[j].note : before
    if (j - i === 1 && j < ev.length && rng.chance(0.4)) {
      ev[i].note = target + (rng.chance(0.55) ? -1 : 1)
      continue
    }
    const idx = nearestIdx(sc, before)
    let step = Math.sign(nearestIdx(sc, target) - idx) || (rng.chance(0.5) ? 1 : -1)
    if (rng.chance(0.2)) step = -step
    ev[i].note = sc[Math.max(0, Math.min(sc.length - 1, idx + step))]
  }
  return ev
}

/** escribe la línea: apoyos atacados, notas de paso ligadas al apoyo anterior (fraseo de viento) */
function writeLine(rec: NoteRec, track: string, ev: Ev[], vel: number): void {
  ev.forEach((e, i) => {
    const prev = ev[i - 1]
    const legato = !e.strong && prev !== undefined && prev.step + prev.len === e.step && prev.note !== e.note
    put(rec, track, e.step, e.len, e.note, e.len >= 2 ? vel : e.strong ? vel - 1 : vel - 3, legato ? { slide: true } : undefined)
  })
}

// ── batería ─────────────────────────────────────────────────────────────────
/** kit de jazz: bombo a pluma, escobilla, pedal, ride, toms de suelo y baqueta cruzada (sin platos largos) */
export const JAZZ_KIT: DrumVoice[] = [
  dv('KICK', 'kick', 0.5, 0.3, 0.35, 0.9),
  dv('SNARE', 'snare', 0.55, 0.3, 0.8, 0.9),
  dv('PEDAL HAT', 'hat', 0.55, 0.1, 0.5, 1),
  dv('RIDE', 'ohat', 0.72, 0.25, 0.7, 1),
  dv('BRUSH', 'snare', 0.4, 0.55, 0.95, 0.8),
  dv('FLOOR TOM', 'tom', 0.3, 0.5, 0.4, 0.8),
  dv('TOM', 'tom', 0.5, 0.4, 0.4, 0.8),
  dv('CROSS STICK', 'rim', 0.5, 0.25, 0.5, 1),
]

/** solo tres niveles de golpe (15 · 9 · 5): cada nivel de velocidad es otra muestra en el cartucho */
const hitAt = (rec: NoteRec, at: number, drum: number, vel: number): void => put(rec, 'ch6', at, 1, drum, vel)

/** swing: ride "tu-tu-ku" (negras y contratiempo de 2 y 4), pedal en 2 y 4, bombo a pluma y alguna bomba */
function swingDrums(rec: NoteRec, rng: Rng, count: number, level: 'soft' | 'full'): void {
  for (let b = 0; b < count; b++) {
    const at = b * 8
    const full = level === 'full'
    for (const s of [0, 2, 3, 4, 6, 7]) hitAt(rec, at + s, DR.OPEN, s === 3 || s === 7 ? 9 : 15)
    for (const s of [2, 6]) hitAt(rec, at + s, DR.HAT, full ? 15 : 9)
    for (const s of [0, 4]) hitAt(rec, at + s, DR.KICK, 5)
    if (!full) continue
    if (b % 2 === 1) hitAt(rec, at + rng.pick([3, 7]), DR.KICK, 15)
    if (rng.chance(0.55)) hitAt(rec, at + rng.pick([3, 5, 7]), DR.SNARE, 5)
    if (b % 4 === 1) hitAt(rec, at + 7, DR.RIM, 9)
    if (b % 4 === 3) {
      hitAt(rec, at + 5, DR.TOM_HI, 9)
      hitAt(rec, at + 6, DR.TOM_LO, 9)
      hitAt(rec, at + 7, DR.SNARE, 15)
    }
  }
}

const FUSION_KICKS = [
  [0, 6, 10],
  [0, 3, 8, 11],
  [0, 7, 10, 14],
]

/** fusión: bombo sincopado, caja en 2 y 4 con fantasmas, charles o ride a corcheas */
function fusionDrums(rec: NoteRec, rng: Rng, count: number, level: 'soft' | 'full', ride: boolean): void {
  const kicks = rng.pick(FUSION_KICKS)
  const ghosts = rng.pick([[7, 15], [9, 15], [7, 9]])
  for (let b = 0; b < count; b++) {
    const at = b * 16
    const full = level === 'full'
    const fill = full && b % 4 === 3
    for (const s of full ? kicks : [0, 10]) hitAt(rec, at + s, DR.KICK, full ? 15 : 9)
    for (const s of [4, 12]) {
      if (fill && s === 12) continue
      hitAt(rec, at + s, full ? DR.SNARE : DR.RIM, full ? 15 : 9)
    }
    if (full) for (const s of ghosts) hitAt(rec, at + s, DR.SNARE, 5)
    for (let s = 0; s < 16; s += 2) hitAt(rec, at + s, ride ? DR.OPEN : DR.HAT, s % 4 === 0 ? 15 : 9)
    if (!fill) continue
    hitAt(rec, at + 12, DR.TOM_HI, 9)
    hitAt(rec, at + 13, DR.TOM_HI, 9)
    hitAt(rec, at + 14, DR.TOM_LO, 9)
    hitAt(rec, at + 15, DR.SNARE, 15)
  }
}

// ── el tema entero ──────────────────────────────────────────────────────────
/** pulsos de BPM que repiten bien en la rejilla de frames del driver (ver ahorro.ts) */
const AUTO_BPM: Record<JazzStyle, number[]> = {
  swing: [136, 144, 150, 150, 156, 164],
  fusion: [102, 108, 114, 120, 120, 126],
}

/** INTRO · HEAD (tema) · SOLO ×2 · BRIDGE · OUT HEAD · TAG; el bucle vuelve al tema */
const PLAN: [string, number][] = [
  ['INTRO', 1],
  ['HEAD', 2],
  ['SOLO', 1],
  ['SOLO 2', 1],
  ['BRIDGE', 1],
  ['OUT HEAD', 2],
  ['TAG', 1],
]

/** el swing se compone en pasos de corchea; el tema usa pasos de semicorchea: cada paso y cada duración, el doble (la batería sigue siendo de un paso) */
function toSixteenths(rec: NoteRec): void {
  for (const [track, notes] of Object.entries(rec)) {
    for (const n of notes) {
      n.step *= 2
      if (track !== 'ch6') n.len *= 2
    }
  }
}

export function generateJazz(song: Song, feel: JazzStyle, rng: Rng, bars: number, autoBpm: boolean): void {
  const swing = feel === 'swing'
  song.beatsPerBar = 4
  song.swing = swing ? 0.33 : 0.06
  song.swingGrid = swing ? 4 : 2
  song.lfo = 2
  song.scale = swing ? 'major' : 'dorian'
  if (autoBpm) song.bpm = rng.pick(AUTO_BPM[feel])
  song.drumKit = JAZZ_KIT.map((v) => ({ ...v }))
  // el swing se compone en corcheas: compases de 8 pasos (ver toSixteenths)
  const env: Env = { ...makeEnv(song, rng), spb: swing ? 8 : 16 }
  const { spb } = env
  const keys = rng.chance(0.5) ? FM.RHODES : FM.EPIANO
  const lead = !swing && rng.chance(0.35) ? FM.BRASS : FM.SAX
  const gtr = (id: 'fm2' | 'fm3') => ({ inst: swing ? FM.JAZZ_GUITAR : keys, name: (swing ? 'GUITAR ' : 'KEYS ') + (id === 'fm2' ? 'L' : 'R'), vol: 100, pan: id === 'fm2' ? ('L' as const) : ('R' as const), gate: swing ? 0.8 : 0.85 })
  setupTracks(song, {
    fm1: swing ? { inst: FM.WALK_BASS, name: 'WALK BASS', vol: 84, pan: 'C', gate: 0.9 } : { inst: FM.SLAP, name: 'SLAP BASS', vol: 84, pan: 'C', gate: 0.6 },
    fm2: gtr('fm2'),
    fm3: gtr('fm3'),
    fm4: { inst: lead, name: lead === FM.BRASS ? 'BRASS' : 'SAX', vol: 92, pan: 'C', gate: 0.9 },
    fm5: { inst: FM.VIBES, name: 'VIBES', vol: 64, pan: 'C', gate: 0.95 },
    ch6: { name: 'JAZZ KIT', vol: 96, pan: 'C' },
    sq1: { inst: PSG.LEAD, name: 'HORN', vol: 70 },
    sq2: { inst: PSG.STAB, name: 'HITS', vol: 64 },
    sq3: { inst: PSG.PLUCK, name: 'ECHO', vol: 70 },
    noise: { name: 'BRUSH', vol: 70 },
  })

  const specs = PROGS[feel][rng.int(0, PROGS[feel].length - 1)]
  const main = progBars(specs, bars, spb)
  const tag = toDominant(main)
  const bridge = toDominant(progBars(specs, bars, spb, 5))
  const range = leadRange(feel)
  const seeds = Array.from({ length: 6 }, () => rng.int(1, 1 << 30))
  const [headSeed, soloSeed, bridgeSeed, compSeed, bassSeed, drumSeed] = seeds
  const total = bars * spb

  const rhythm = (rec: NoteRec, chords: JC[][], level: 'soft' | 'full', vel: number, o: { sparse?: boolean; ride?: boolean } = {}): void => {
    writeComp(env, rec, feel, chords, new Rng(compSeed), vel, o.sparse)
    if (swing) walkBass(env, rec, 'fm1', chords, new Rng(bassSeed), 11)
    else slapBass(env, rec, 'fm1', chords, new Rng(bassSeed), 11)
    if (swing) swingDrums(rec, new Rng(drumSeed), bars, level)
    else fusionDrums(rec, new Rng(drumSeed), bars, level, o.ride === true)
  }
  const line = (rec: NoteRec, seed: number, chords: JC[][], vel: number, dense: boolean, rest: number): void => {
    writeLine(rec, 'fm4', jazzLine(env, feel, chords, new Rng(seed), { lo: range[0], hi: range[1], dense, rest }), vel)
  }
  const echoes = (rec: NoteRec): void => writeEcho(rec, 'fm4', 'sq3', 3, 8, total)
  const hits = (rec: NoteRec): void => {
    for (const n of rec.fm5 ?? []) put(rec, 'sq2', n.step, Math.min(n.len, 2), n.note, 9)
  }
  const double = (rec: NoteRec): void => {
    for (const n of rec.fm4 ?? []) put(rec, 'sq1', n.step, n.len, n.note + 12, 6)
  }

  const section = (name: string, repeat: number, build: (rec: NoteRec) => void): void =>
    addSection(song, name, bars, repeat, (rec) => {
      build(rec)
      if (swing) toSixteenths(rec)
    })
  for (const [name, repeat] of PLAN) {
    section(name, repeat, (rec) => {
      if (name === 'INTRO') rhythm(rec, main, 'soft', 9)
      else if (name === 'HEAD') {
        rhythm(rec, main, 'full', 10)
        line(rec, headSeed, main, 13, false, 0)
        echoes(rec)
      } else if (name === 'SOLO') {
        rhythm(rec, main, 'full', 10, { ride: true })
        line(rec, soloSeed, main, 13, true, 0.15)
        echoes(rec)
      } else if (name === 'SOLO 2') {
        rhythm(rec, main, 'full', 11, { ride: true })
        line(rec, soloSeed + 1, main, 13, true, 0.1)
        hits(rec)
      } else if (name === 'BRIDGE') {
        rhythm(rec, bridge, 'soft', 10)
        line(rec, bridgeSeed, bridge, 12, false, 0)
        echoes(rec)
      } else if (name === 'OUT HEAD') {
        rhythm(rec, main, 'full', 11)
        line(rec, headSeed, main, 13, false, 0)
        double(rec)
        hits(rec)
      } else rhythm(rec, tag, 'soft', 9, { sparse: true })
    })
  }
  song.loopStart = 1
}

// ── relleno de una sola pista (botón "dado") ─────────────────────────────────
/** Notas nuevas para una pista de un patrón, con el lenguaje del estilo y los acordes de una de sus progresiones. */
export function jazzTrackNotes(song: Song, pat: Pattern, trackId: string, kind: FillKind, rng: Rng, feel: JazzStyle): Note[] {
  const swing = feel === 'swing'
  const env: Env = { ...makeEnv(song, rng), spb: swing ? 8 : 16 }
  const { spb } = env
  const bars = progBars(PROGS[feel][rng.int(0, PROGS[feel].length - 1)], pat.bars, spb)
  const tr = song.tracks.find((t) => t.id === trackId)
  const noise = tr?.kind === 'noise'
  const rec: NoteRec = {}
  let from = trackId
  switch (kind) {
    case 'bass':
      if (swing) walkBass(env, rec, trackId, bars, rng, 11)
      else slapBass(env, rec, trackId, bars, rng, 11)
      break
    case 'chords':
      // cada pista del teclado toma su voz; en otra pista, la del medio
      writeComp(env, rec, feel, bars, rng, 10)
      from = COMP_TRACKS.includes(trackId) ? trackId : 'fm3'
      break
    case 'arp': {
      // arpegio de las notas guía de cada acorde, de ida y vuelta
      const rate = swing ? 1 : 2
      bars.forEach((cs, b) => {
        for (const c of cs) {
          const t = TONES[c.q]
          const pcs = [t.third, t.fifth, t.seventh, t.color[0]].map((iv) => mod12(env.key + c.root + iv))
          const ladder = within(60, 84, pcs)
          const cycle = Math.max(1, 2 * (ladder.length - 1))
          for (let s = 0, k = 0; s < c.len; s += rate, k++) {
            const i = k % cycle
            put(rec, trackId, b * spb + c.at + s, rate, ladder[i < ladder.length ? i : cycle - i], k % 4 === 0 ? 10 : 8)
          }
        }
      })
      break
    }
    case 'lead':
      writeLine(rec, trackId, jazzLine(env, feel, bars, rng, { lo: leadRange(feel)[0], hi: leadRange(feel)[1], dense: rng.chance(0.5), rest: 0.1 }), 13)
      break
    case 'drums':
    case 'perc':
      if (noise) {
        // escobilla en el ruido: el pulso del ride (swing) o corcheas (fusión)
        for (let b = 0; b < pat.bars; b++) {
          for (const s of swing ? [0, 2, 3, 4, 6, 7] : [0, 2, 4, 6, 8, 10, 12, 14]) put(rec, 'noise', b * spb + s, 1, NZ.HAT, kind === 'perc' ? 3 : 5)
        }
        from = 'noise'
      } else {
        if (kind === 'drums') {
          if (swing) swingDrums(rec, rng, pat.bars, 'full')
          else fusionDrums(rec, rng, pat.bars, 'full', rng.chance(0.4))
        } else {
          // percusión suelta: baqueta cruzada y fantasmas a contratiempo
          for (let b = 0; b < pat.bars; b++) {
            for (const s of swing ? [3, 7] : [7, 9, 15]) hitAt(rec, b * spb + s, DR.RIM, 9)
            if (rng.chance(0.6)) hitAt(rec, b * spb + (swing ? 5 : 11), DR.SNARE, 5)
          }
        }
        from = 'ch6'
      }
      break
  }
  // la batería solo tiene sentido en pistas de batería
  if ((kind === 'drums' || kind === 'perc') && tr?.kind !== 'dac' && !noise) return []
  if (swing) toSixteenths(rec)
  const max = patternSteps(song, pat)
  return (rec[from] ?? [])
    .filter((n) => n.step < max)
    .map((n) => ({ ...n, len: Math.max(1, Math.min(n.len, max - n.step)) }))
    .sort((a, b) => a.step - b.step || a.note - b.note)
}

// ── para comprobar la armonía de un tema generado (tests) ────────────────────
export type JazzChord = JC
/** las progresiones del estilo expandidas a `bars` compases */
export const jazzProgressions = (feel: JazzStyle, bars: number, spb: number): JC[][][] => PROGS[feel].map((s) => progBars(s, bars, spb))
/** clases de altura (0-11) de las notas del acorde: fundamental, tercera, quinta, séptima y primera extensión */
export const chordTonePcs = (key: number, c: JC): number[] => {
  const t = TONES[c.q]
  return [0, t.third, t.fifth, t.seventh, t.color[0]].map((iv) => mod12(key + c.root + iv))
}
/** clases de altura de la escala del acorde */
export const chordScalePcs = (key: number, c: JC): number[] => chordScale(c).map((iv) => mod12(key + c.root + iv))
/** clases de altura que puede llevar una voz del teclado: tercera, séptima y las extensiones del acorde */
export const voicingPcs = (key: number, c: JC): number[] => {
  const t = TONES[c.q]
  return [t.third, t.seventh, ...t.color].map((iv) => mod12(key + c.root + iv))
}
