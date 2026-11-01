// ── Estilos electrónicos: COSMIC DISCO · TECHNO MINIMAL · DARK ───────────────
//
// A diferencia de los estilos "genéricos", aquí cada estilo tiene su propio
// reparto de pistas, su kit de batería y su forma de construir las secciones:
//
//   cosmic   space disco serio y teatral, siempre en menor: progresiones con
//            cadencia, tema por ideas y secuencias, cuerdas y coro, timbales
//            afinados (vive en cosmic.ts)
//   minimal  techno minimal de Detroit: 909, armonía estática, un riff de campana
//            cuyo ciclo de alturas no cuadra con el de ritmo (se desfasa), stabs
//   dark     dos caras: EBM (bajo en semicorcheas, percusión industrial) o
//            "giallo" (pulso en corcheas, arpegio con sexta menor, coro, theremin)
//
// Los acordes sostenidos se reparten en tres canales FM (una nota por canal)
// para que suenen como un acorde de verdad y no como el arpegio de 60 Hz.
// La base común (armonía, bajo, acordes, arpegios, melodía) está en electrokit.ts.
import { cosmicFill, genCosmic, type CosmicOpts } from './cosmic'
import {
  PAD_TRACKS,
  X,
  addSection,
  dv,
  h,
  hiss,
  hit,
  legato,
  makeEnv,
  merge,
  mod12,
  padVoices,
  relPc,
  riser,
  roll,
  setScale,
  setupTracks,
  writeBass,
  writeEcho,
  writeMelody,
  writePads,
  type BassPat,
  type Env,
  type Harm,
} from './electrokit'
import { DR, FM, NZ, PSG, Rng, grid, put, type FillKind, type NoteRec } from './genkit'
import type { DrumVoice, Note, Pattern, Song } from './song'
import { patternSteps } from './song'
import { chordById, diatonicChord } from './theory'

export type ElectroStyle = 'cosmic' | 'minimal' | 'dark'
export const isElectro = (s: string): s is ElectroStyle => s === 'cosmic' || s === 'minimal' || s === 'dark'
export const ELECTRO_BPM: Record<ElectroStyle, [number, number]> = {
  cosmic: [114, 124],
  minimal: [132, 140],
  dark: [110, 130],
}

// ═════════════════════════════════════════════════════════════════════════════
//  TECHNO MINIMAL
// ═════════════════════════════════════════════════════════════════════════════
const MIN_RIFFS = [
  'X..x..x.|..x..x..',
  'X.x..x.x|..x.x..x',
  '..x.x..X|..x.x..x',
  'X..x.x..|x..x.x..',
  'X.xx.x.x|x.xx.x.x',
  'x.x.X..x|.x.x..x.',
  'X...x.x.|.x..x.x.',
]
const MIN_STABS = ['...x..x.|...x..x.', '..x...x.|..x...x.', 'x.....x.|...x....', '...x...x|...x.x..', '..x..x..|..x..x..']
const MIN_RIMS = ['...x..x.|..x.....', '..x....x|..x..x..', '....x..x|.x..x...', '.x..x..x|.x..x...']
/** [conga aguda, conga grave] */
const MIN_CONGAS: [string, string][] = [
  ['..x..x..|.x....x.', '.......x|...x....'],
  ['.x...x..|..x..x..', '...x....|.x.....x'],
  ['..x.x...|..x.x...', '.......x|.......x'],
]
/** disposiciones del stab (semitonos sobre la tónica): m7 sin fundamental, cuartas, triada, 2ª inversión */
const STAB_VOICINGS = [
  [-2, 3, 7],
  [0, 5, 10],
  [0, 3, 7],
  [-5, 0, 3],
  [3, 7, 10],
]
const MIN_POOLS: Record<'minor' | 'phrygian', number[][]> = {
  minor: [[0, 3, 7], [0, 7, 10], [0, 5, 7], [0, 3, 5, 10], [0, 2, 3, 7], [0, 3, 7, 10]],
  phrygian: [[0, 1, 7], [0, 1, 5, 7], [0, 7, 8], [0, 1, 3, 7]],
}

interface MinBass extends BassPat {
  inst: number
}
const MIN_BASS: MinBass[] = [
  { inst: FM.SUB, len: 2, steps: [X, X, 0, X, X, X, 0, X, X, X, 0, X, X, X, 0, X] }, // sub a contratiempo
  { inst: FM.PLUCK, len: 1, steps: [X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 98] }, // rodante entre bombos
  { inst: FM.SUB, len: 2, steps: [X, X, X, 0, X, X, 0, X, X, X, X, 0, X, X, 0, X] }, // 3-3-2
  { inst: FM.ACID, len: 1, steps: [0, X, 0, 12, X, 0, X, 0, 12, X, 0, X, 0, X, 12, 97], slides: [3, 8, 15] }, // secuencia ácida, con los saltos ligados
  { inst: FM.PLUCK, len: 1, steps: [X, X, 0, 0, X, X, 0, 0, X, X, 0, 0, X, X, 0, 12] }, // galope a contratiempo
]

interface Riff {
  hits: { step: number; vel: number }[]
  cycle: number[]
}

/**
 * Riff de un compás. El ciclo de alturas tiene una longitud distinta al número
 * de golpes, así que el dibujo melódico se va desplazando compás a compás.
 */
function makeRiff(rng: Rng, templates: string[], pool: number[]): Riff {
  const hits = grid(rng.pick(templates))
  let n = rng.pick([3, 4, 5, 7])
  if (n === hits.length) n++
  const cycle: number[] = []
  let i = 0
  for (let k = 0; k < n; k++) {
    cycle.push(pool[i])
    const r = rng.next()
    if (r >= 0.4) i = r < 0.8 ? (i + 1) % pool.length : rng.int(0, pool.length - 1)
  }
  if (new Set(cycle).size === 1 && pool.length > 1) cycle[cycle.length - 1] = pool[1]
  return { hits, cycle }
}

interface RiffOpts {
  vel: number
  from?: number
  to?: number
  fade?: boolean
  /** cada golpe salta de un altavoz al otro (el acento del compás, al centro) */
  pingPong?: boolean
}

function writeRiff(env: Env, rec: NoteRec, track: string, riff: Riff, bars: number, base: number, o: RiffOpts): void {
  const from = o.from ?? 0
  const to = o.to ?? bars
  let k = 0
  for (let b = from; b < to; b++) {
    const at = b * env.spb
    const mul = o.fade ? (b - from + 1) / (to - from) : 1
    riff.hits.forEach((g, i) => {
      if (g.step >= env.spb) return
      const next = riff.hits[i + 1]?.step ?? env.spb
      const vel = Math.max(3, Math.round((o.vel + (g.vel >= 15 ? 2 : 0)) * mul))
      const pan = !o.pingPong || g.vel >= 15 ? undefined : k % 2 === 0 ? 'L' : 'R'
      put(rec, track, at + g.step, Math.max(1, Math.min(2, next - g.step)), base + riff.cycle[k % riff.cycle.length], vel, { pan })
      k++
    })
  }
}

/** altura de referencia del stab: la tónica entre Do4 y Si4 */
const stabBase = (env: Env): number => (env.midTonic < 60 ? env.midTonic + 12 : env.midTonic)

/** stab a tres voces; en el último compás de cada frase de 4 se desplaza en paralelo ("planing") */
function writeStabs(env: Env, rec: NoteRec, bars: number, template: string, voicing: number[], o: { vel: number; from?: number; to?: number; plane?: number }): void {
  const hits = grid(template)
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const shift = o.plane && b % 4 === 3 ? o.plane : 0
    hits.forEach((g, i) => {
      if (g.step >= env.spb) return
      const len = Math.max(1, Math.min(2, (hits[i + 1]?.step ?? env.spb) - g.step))
      voicing.forEach((iv, v) => put(rec, PAD_TRACKS[v], b * env.spb + g.step, len, stabBase(env) + iv + shift, o.vel + (g.vel >= 15 ? 2 : 0)))
    })
  }
}

/** nota cada `cycle` pasos sin mirar la barra de compás: polirritmia de 3, 5 o 6 contra 16 */
function writePoly(env: Env, rec: NoteRec, track: string, from: number, to: number, cycle: number, notes: number[], vel: number): void {
  let k = 0
  for (let g = from; g < to; g += cycle, k++) put(rec, track, g, 1, notes[k % notes.length], vel + (g % env.spb === 0 ? 2 : 0))
}

interface TechnoOpts {
  from?: number
  to?: number
  kick?: boolean
  hats?: 'none' | 'closed' | 'open'
  hatVel?: number
  clap?: boolean
  rim?: string | null
  congas?: [string, string] | null
  /** canal de ruido: shaker en semicorcheas o "ride" en corcheas */
  air?: 'none' | 'shaker' | 'ride'
  crash?: boolean
}

function technoDrums(env: Env, rec: NoteRec, bars: number, o: TechnoOpts): void {
  const { spb } = env
  const from = o.from ?? 0
  const hv = o.hatVel ?? 1
  for (let b = from; b < (o.to ?? bars); b++) {
    const at = b * spb
    if (o.kick) for (let s = 0; s < spb; s += 4) hit(rec, at + s, DR.KICK, s % 8 === 0 ? 15 : 14)
    if (o.clap) for (const s of [4, 12]) if (s < spb) hit(rec, at + s, DR.CLAP, 13)
    const hats = o.hats ?? 'none'
    for (let s = 0; s < spb; s++) {
      const q = s % 4
      if (hats === 'open' && q === 2) hit(rec, at + s, DR.OPEN, Math.round(10 * hv))
      else if (hats !== 'none') hit(rec, at + s, DR.HAT, Math.max(2, Math.round([5, 3, 9, 4][q] * hv)))
      if (o.air === 'shaker') hiss(rec, at + s, NZ.HAT, [4, 3, 6, 3][q])
      else if (o.air === 'ride' && s % 2 === 0) hiss(rec, at + s, NZ.OPEN, q === 0 ? 8 : 6, 2)
    }
    if (o.rim) for (const g of grid(o.rim)) if (g.step < spb) hit(rec, at + g.step, DR.RIM, 9)
    if (o.congas) {
      for (const g of grid(o.congas[0])) if (g.step < spb) hit(rec, at + g.step, DR.TOM_HI, 9)
      for (const g of grid(o.congas[1])) if (g.step < spb) hit(rec, at + g.step, DR.TOM_LO, 10)
    }
  }
  if (o.crash) hit(rec, from * spb, DR.OPEN, 15)
}

/**
 * El kit 909 de TECHNO MINIMAL. El presupuesto de ROM lo cuenta como kit compartido: sus muestras
 * se guardan una sola vez.
 */
export const KIT_909: DrumVoice[] = [
  dv('KICK 909', 'kick', 0.36, 0.56, 0.6, 1),
  dv('SNARE', 'snare', 0.55, 0.35, 0.7, 0.85),
  dv('HAT', 'hat', 0.62, 0.12, 0.65, 0.6),
  dv('OPEN HAT', 'ohat', 0.6, 0.5, 0.6, 0.62),
  dv('CLAP', 'clap', 0.55, 0.42, 0.5, 0.85),
  dv('CONGA LO', 'tom', 0.45, 0.3, 0.25, 0.8),
  dv('CONGA HI', 'tom', 0.72, 0.25, 0.25, 0.8),
  dv('RIM', 'rim', 0.55, 0.3, 0.5, 0.8),
]

function minimalKit(song: Song): void {
  song.drumKit = KIT_909.map((v) => ({ ...v }))
}

function genMinimal(env: Env, bars: number): void {
  const { rng, song, spb } = env
  const mode: 'minor' | 'phrygian' = rng.chance(0.4) ? 'phrygian' : 'minor'
  setScale(env, mode)
  // armonía estática: todo el tema descansa sobre la tónica
  const prog = [h(0, 'min7')]
  const pool = rng.pick(MIN_POOLS[mode])
  const riffA = makeRiff(rng, MIN_RIFFS, pool)
  const bass = rng.pick(MIN_BASS)
  const stabT = rng.pick(MIN_STABS)
  const voicing = rng.pick(mode === 'phrygian' ? [STAB_VOICINGS[1], STAB_VOICINGS[3], STAB_VOICINGS[2]] : STAB_VOICINGS)
  const plane = rng.pick([0, 2, -2, 3])
  const rim = rng.pick(MIN_RIMS)
  const congas = rng.pick(MIN_CONGAS)
  const polyCycle = rng.pick([3, 5, 6])
  const total = bars * spb
  const half = Math.floor(bars / 2)
  const bellBase = env.midTonic + 12
  const blips = pool.map((p) => env.midTonic + 24 + p)

  minimalKit(song)
  setupTracks(song, {
    fm1: { inst: bass.inst, name: 'BASS', vol: 96, pan: 'C', gate: 0.55, glide: 3 },
    fm2: { inst: FM.STAB, name: 'STAB L', vol: 84, pan: 'L' },
    fm3: { inst: FM.STAB, name: 'STAB R', vol: 84, pan: 'R' },
    fm4: { inst: FM.TECHNO_BELL, name: 'BELL', vol: 90, pan: 'C' },
    fm5: { inst: FM.STAB, name: 'STAB C', vol: 80, pan: 'C' },
    ch6: { name: 'DRUMS 909', vol: 100, pan: 'C' },
    sq1: { inst: PSG.BLIP, name: 'BLIP', vol: 100 },
    sq2: { inst: PSG.PLUCK, name: 'ECHO', vol: 70 },
    sq3: { inst: PSG.STAB, name: 'PULSE', vol: 80 },
    noise: { name: 'AIR', vol: 90 },
  })

  const pulse = (rec: NoteRec, from = 0, to = bars): void => {
    // pulso a contratiempo en la quinta: empuja sin añadir armonía
    for (let b = from; b < to; b++) for (let s = 2; s < spb; s += 4) put(rec, 'sq3', b * spb + s, 1, env.midTonic - 12 + 7, 9)
  }

  addSection(song, 'INTRO', bars, 1, (rec) => {
    technoDrums(env, rec, bars, { kick: true, hats: 'closed', hatVel: 0.8 })
    technoDrums(env, rec, bars, { from: half, rim })
    // el riff entra de lejos y va creciendo
    writeRiff(env, rec, 'fm4', riffA, bars, bellBase, { vel: 11, from: half, fade: true })
  })

  addSection(song, 'A', bars, 2, (rec) => {
    technoDrums(env, rec, bars, { kick: true, hats: 'closed', rim, air: 'shaker', crash: true })
    writeBass(env, rec, 'fm1', prog, bars, bass, { vel: 13 })
    writeRiff(env, rec, 'fm4', riffA, bars, bellBase, { vel: 13 })
  })

  addSection(song, 'B', bars, 2, (rec) => {
    technoDrums(env, rec, bars, { kick: true, hats: 'open', clap: true, rim, air: 'shaker', crash: true })
    writeBass(env, rec, 'fm1', prog, bars, bass, { vel: 13 })
    // con los stabs abriendo el estéreo, la campana empieza a saltar de lado a lado
    writeRiff(env, rec, 'fm4', riffA, bars, bellBase, { vel: 13, pingPong: true })
    writeStabs(env, rec, bars, stabT, voicing, { vel: 13, plane })
    writePoly(env, rec, 'sq1', 0, total, polyCycle, blips, 10)
    pulse(rec)
  })

  addSection(song, 'BRK', bars, 1, (rec) => {
    // sin bombo: quedan el riff, los stabs y el aire; redoble y subida al final
    const build = Math.max(1, Math.min(2, bars - 1))
    technoDrums(env, rec, bars, { hats: 'closed', hatVel: 0.7, to: bars - build })
    writeRiff(env, rec, 'fm4', riffA, bars, bellBase, { vel: 12, pingPong: true })
    writeEcho(rec, 'fm4', 'sq2', 3, 8, total, 12)
    writeStabs(env, rec, bars, stabT, voicing, { vel: 12, plane })
    writePoly(env, rec, 'sq1', 0, total, polyCycle, blips, 9)
    roll(rec, (bars - build) * spb, total, DR.SNARE, 3, 14)
    riser(rec, (bars - build) * spb, total)
  })

  addSection(song, 'FINAL', bars, 2, (rec) => {
    technoDrums(env, rec, bars, { kick: true, hats: 'open', clap: true, rim, congas, air: 'ride', crash: true })
    writeBass(env, rec, 'fm1', prog, bars, bass, { vel: 13 })
    writeRiff(env, rec, 'fm4', riffA, bars, bellBase, { vel: 14, pingPong: true })
    writeEcho(rec, 'fm4', 'sq2', 3, 9, total, 12)
    writeStabs(env, rec, bars, stabT, voicing, { vel: 14, plane })
    writePoly(env, rec, 'sq1', 0, total, polyCycle, blips, 11)
    pulse(rec)
  })

  addSection(song, 'OUTRO', bars, 1, (rec) => {
    technoDrums(env, rec, bars, { kick: true, hats: 'closed', rim })
    writeBass(env, rec, 'fm1', prog, bars, bass, { to: half })
    writeRiff(env, rec, 'fm4', riffA, bars, bellBase, { vel: 11, to: Math.max(1, half) })
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  DARK
// ═════════════════════════════════════════════════════════════════════════════
type DarkVariant = 'ebm' | 'giallo'

const DARK_PROGS: Record<DarkVariant, Harm[][]> = {
  ebm: [
    [h(0, 'min'), h(0, 'min'), h(0, 'min'), h(1, 'maj')], // i – i – i – bII
    [h(0, 'min'), h(0, 'min'), h(8, 'maj'), h(7, 'maj')], // i – i – bVI – V
    [h(0, 'min'), h(1, 'maj'), h(0, 'min'), h(10, 'min')], // i – bII – i – bvii
    [h(0, 'power'), h(0, 'power'), h(3, 'power'), h(1, 'power')], // quintas: i – i – bIII – bII
  ],
  giallo: [
    [h(0, 'min'), h(8, 'maj'), h(1, 'maj'), h(7, 'maj')], // i – bVI – bII – V
    [h(0, 'min'), h(8, 'min'), h(0, 'min'), h(8, 'min')], // i – bvi (mediante cromática)
    [h(0, 'min'), h(10, 'maj'), h(8, 'maj'), h(7, 'maj')], // cadencia andaluza
    [h(0, 'min'), h(5, 'min'), h(1, 'maj'), h(0, 'min')], // i – iv – bII – i
  ],
}

const DARK_BASS: Record<DarkVariant, BassPat[]> = {
  ebm: [
    { len: 1, steps: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12] },
    { len: 1, steps: [0, X, 0, 0, X, 0, 0, X, 0, X, 0, 0, X, 0, 97, 0] },
    { len: 1, steps: [0, 0, 0, 96, 0, 0, 0, 97, 0, 0, 0, 96, 0, 97, 0, 98] },
    { len: 1, steps: [0, 0, X, 0, 0, X, 0, 0, X, 0, 0, X, 0, 0, 96, 97] },
    { len: 1, steps: [0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 0, X, 12, 12] },
  ],
  giallo: [
    { len: 2, steps: [0, X, 0, X, 0, X, 0, X, 0, X, 0, X, 0, X, 12, X] },
    { len: 2, steps: [0, X, 0, X, 12, X, 0, X, 0, X, 0, X, 12, X, 0, X] },
    { len: 1, steps: [0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 0, X, 7, 12] },
  ],
}

/**
 * Arpegios oscuros, 8 notas por ciclo: r = fundamental, t = tercera, f = quinta,
 * o = octava, T = tercera alta, n = vecina por encima de la quinta (la sexta
 * menor sobre un acorde menor: el color "de terror").
 */
const DARK_ARPS = ['rfofTfof', 'ofofnfof', 'rtfoftrt', 'rofotofo', 'ofnfofTf']

/** frames de portamento del theremin (83 ms): se oye el glissando de nota a nota */
const THEREMIN_GLIDE = 5

const DARK_RHYTHMS: [number, number][][] = [
  [[0, 8], [8, 4], [12, 4], [16, 12]],
  [[0, 12], [12, 4], [16, 8], [24, 8]],
  [[4, 4], [8, 8], [16, 4], [20, 4], [24, 8]],
  [[0, 6], [6, 2], [8, 8], [16, 6], [22, 2], [24, 8]],
  [[0, 16], [16, 8], [24, 8]],
]

function darkArpNote(env: Env, c: Harm, base: number, ch: string): number {
  const iv = chordById(c.type).intervals
  let root = base + mod12(env.key + c.root - base)
  if (root > base + 7) root -= 12
  const third = iv.find((i) => i === 3 || i === 4) ?? 7
  const fifth = iv.find((i) => i === 6 || i === 7 || i === 8) ?? 7
  switch (ch) {
    case 't':
      return root + third
    case 'f':
      return root + fifth
    case 'o':
      return root + 12
    case 'T':
      return root + 12 + third
    case 'n': {
      // primera nota de la escala por encima de la quinta
      for (let m = root + fifth + 1; m <= root + fifth + 3; m++) if (env.scale.includes(relPc(env, m))) return m
      return root + fifth + 1
    }
    default:
      return root
  }
}

function writeDarkArp(env: Env, rec: NoteRec, track: string, prog: Harm[], bars: number, o: { shape: string; rate: 1 | 2; base: number; vel: number; from?: number; to?: number }): void {
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const c = prog[b % prog.length]
    const at = b * env.spb
    for (let s = 0, k = 0; s < env.spb; s += o.rate, k++) {
      put(rec, track, at + s, o.rate, darkArpNote(env, c, o.base, o.shape[k % o.shape.length]), o.vel + (s % 4 === 0 ? 2 : s % 2 === 0 ? 0 : -2))
    }
  }
}

interface DarkOpts {
  from?: number
  to?: number
  kick?: 'none' | 'four' | 'heart'
  snare?: boolean
  hats?: 'none' | 'offbeat' | '16'
  anvil?: number[] | null
  buzz?: boolean
  fill?: boolean
}

function darkDrums(env: Env, rec: NoteRec, bars: number, o: DarkOpts): void {
  const { spb } = env
  const to = o.to ?? bars
  for (let b = o.from ?? 0; b < to; b++) {
    const at = b * spb
    const filling = !!o.fill && (b === to - 1 || b % 8 === 7)
    if (o.kick === 'four') for (let s = 0; s < spb; s += 4) hit(rec, at + s, DR.KICK, s % 8 === 0 ? 15 : 13)
    // latido: dos golpes seguidos y silencio
    else if (o.kick === 'heart') for (const [s, v] of [[0, 12], [3, 9]]) if (s < spb) hit(rec, at + s, DR.KICK, v)
    if (o.snare) for (const s of [4, 12]) if (s < spb && !(filling && s === 12)) hit(rec, at + s, DR.SNARE, 14)
    for (let s = 0; s < spb; s++) {
      const q = s % 4
      if (o.hats === '16') hit(rec, at + s, DR.HAT, [4, 3, 9, 3][q])
      else if (o.hats === 'offbeat' && q === 2) hit(rec, at + s, DR.HAT, 8)
      // zumbido de ruido periódico en corcheas: textura industrial
      if (o.buzz && s % 2 === 0) hiss(rec, at + s, NZ.BUZZ, q === 0 ? 7 : 9)
    }
    if (o.anvil) for (const s of o.anvil) if (s < spb && !(filling && s >= 8)) hit(rec, at + s, DR.RIM, 9)
    if (filling && spb >= 16) {
      // tambores de guerra hacia el siguiente compás
      for (const [s, d, v] of [[10, DR.TOM_HI, 11], [12, DR.TOM_HI, 12], [13, DR.TOM_LO, 12], [14, DR.TOM_LO, 13], [15, DR.TOM_LO, 14]]) hit(rec, at + s, d, v)
    }
  }
}

function darkKit(song: Song): void {
  song.drumKit = [
    dv('KICK', 'kick', 0.3, 0.62, 0.7, 1),
    dv('SNARE', 'snare', 0.38, 0.75, 0.75, 0.9),
    dv('HAT', 'hat', 0.4, 0.15, 0.4, 0.6),
    dv('OPEN HAT', 'ohat', 0.42, 0.6, 0.35, 0.6),
    dv('CLAP', 'clap', 0.3, 0.6, 0.5, 0.8),
    dv('TOM LO', 'tom', 0.12, 0.7, 0.6, 0.95),
    dv('TOM HI', 'tom', 0.3, 0.55, 0.6, 0.9),
    dv('ANVIL', 'cow', 0.15, 0.6, 0.5, 0.7),
  ]
}

/** lo que se puede fijar de un tema DARK en vez de dejarlo al azar */
export interface DarkGenOpts {
  /** EBM (bajo en semicorcheas, más rápido) o giallo (pulso en corcheas, arpegio con sexta menor, coro) */
  variant?: DarkVariant
  /** el lead es siempre el theremin, nunca la campana */
  theremin?: boolean
  /** el arpegio lleva siempre la sexta menor (el «neón»): descarta las formas que no la tocan */
  neon?: boolean
  /** el bajo toca siempre corcheas (el pulso del punk): descarta los dibujos en semicorcheas */
  eighths?: boolean
  /** progresión de la variante (índice en DARK_PROGS) en vez de una al azar */
  prog?: number
}

function genDark(env: Env, bars: number, autoBpm: boolean, o: DarkGenOpts = {}): void {
  const { rng, song, spb } = env
  const rolled: DarkVariant = rng.chance(0.55) ? 'ebm' : 'giallo'
  const variant: DarkVariant = o.variant ?? rolled
  const ebm = variant === 'ebm'
  if (autoBpm) song.bpm = ebm ? rng.int(122, 130) : rng.int(110, 120)
  setScale(env, 'phrygian')
  const rolledProg = rng.pick(DARK_PROGS[variant])
  const prog = o.prog !== undefined ? DARK_PROGS[variant][o.prog % DARK_PROGS[variant].length] : rolledProg
  const brkProg = prog.flatMap((c) => [c, c])
  const rolledA = rng.pick(DARK_BASS[variant])
  const rolledB = rng.pick(DARK_BASS[variant].filter((p) => p !== rolledA))
  // con `eighths`, los dos bajos de la canción son dibujos de corcheas (el segundo, distinto si lo hay)
  const pulse = DARK_BASS[variant].filter((p) => p.len === 2)
  const bassA = o.eighths && rolledA.len !== 2 ? rng.pick(pulse) : rolledA
  const bassB = o.eighths && rolledB.len !== 2 ? (pulse.find((p) => p !== bassA) ?? bassA) : rolledB
  const rolledArp = rng.pick(DARK_ARPS)
  const arpShape = o.neon && !rolledArp.includes('n') ? rng.pick(DARK_ARPS.filter((a) => a.includes('n'))) : rolledArp
  const arpRate: 1 | 2 = ebm || rng.chance(0.6) ? 1 : 2
  const anvil = rng.pick([[3, 11], [7, 15], [0, 6, 11], [10]])
  const bellRoll = !ebm && rng.chance(0.35)
  const bellLead = bellRoll && !o.theremin
  const total = bars * spb
  const half = Math.floor(bars / 2)
  const arpBase = env.midTonic + 7
  /** golpe grave de ruido al entrar en una sección (se llama al final: despeja el primer pulso del canal) */
  const impact = (rec: NoteRec): void => {
    rec.noise = (rec.noise ?? []).filter((n) => n.step >= 4)
    hiss(rec, 0, NZ.RUMBLE, 12, 4)
  }
  /** nota pedal hueca en la tónica (onda cuadrada) */
  const drone = (rec: NoteRec, from = 0, to = bars): void => {
    for (let b = from; b < to; b += 2) put(rec, 'sq3', b * spb, Math.min(2, to - b) * spb, env.midTonic - 12, 6)
  }

  const bassInst = ebm ? rng.pick([FM.GROWL, FM.REESE]) : rng.pick([FM.SEQ_BASS, FM.GROWL])
  darkKit(song)
  song.lfo = 1 // el LFO del chip mueve el trémolo del DARK PAD
  setupTracks(song, {
    fm1: { inst: bassInst, name: 'BASS', vol: bassInst === FM.SEQ_BASS ? 88 : 84, pan: 'C', gate: ebm ? 0.6 : 0.66 },
    fm2: { inst: FM.DARK_PAD, name: 'CHOIR L', vol: 62, pan: 'L', gate: 0.98 },
    fm3: { inst: FM.DARK_PAD, name: 'CHOIR R', vol: 62, pan: 'R', gate: 0.98 },
    fm4: { inst: bellLead ? FM.BELL : FM.THEREMIN, name: bellLead ? 'BELL' : 'THEREMIN', vol: bellLead ? 84 : 76, pan: 'C', glide: bellLead ? 0 : THEREMIN_GLIDE },
    fm5: { inst: FM.CHOIR, name: 'CHOIR C', vol: 46, pan: 'C', gate: 0.98 },
    ch6: { name: 'DRUMS', vol: 100, pan: 'C' },
    sq1: { inst: PSG.PLUCK, name: 'ARP', vol: ebm ? 72 : 86 },
    sq2: { inst: PSG.PLUCK, name: 'ECHO', vol: 66 },
    sq3: { inst: PSG.PAD, name: 'DRONE', vol: 60 },
    noise: { name: 'NOISE', vol: 90 },
  })

  const lead: NoteRec = {}
  writeMelody(env, lead, { track: 'fm4', lo: env.midTonic + 12, hi: env.midTonic + 27, rhythms: DARK_RHYTHMS, moves: [10, 30, 34, 8, 10, 3, 3, 1, 1], vel: 12 }, prog, bars)
  const leadBrk: NoteRec = {}
  writeMelody(env, leadBrk, { track: 'fm4', lo: env.midTonic + 12, hi: env.midTonic + 27, rhythms: DARK_RHYTHMS.slice(0, 3), moves: [10, 30, 34, 8, 10, 3, 3, 1, 1], vel: 11 }, brkProg, bars)
  // un theremin no ataca cada nota: dentro de cada frase de dos compases se desliza de una a otra
  if (!bellLead) for (const l of [lead, leadBrk]) legato(l.fm4 ?? [], 2 * spb)

  const arp = (rec: NoteRec, vel: number, p = prog, from = 0, to = bars): void => {
    writeDarkArp(env, rec, 'sq1', p, bars, { shape: arpShape, rate: arpRate, base: arpBase, vel, from, to })
  }
  const echo = (rec: NoteRec, vel = 6): void => writeEcho(rec, 'sq1', 'sq2', 3, vel, total)
  const pads = (rec: NoteRec, vel: number, p = prog): void => writePads(env, rec, p, bars, { vel: vel + 3, lo: 45, hi: 67 })

  addSection(song, 'INTRO', bars, 1, (rec) => {
    pads(rec, 8)
    drone(rec)
    if (ebm) {
      // el bajo arranca solo, con el charles marcando el contratiempo
      writeBass(env, rec, 'fm1', prog, bars, bassA, { vel: 10 })
      darkDrums(env, rec, bars, { hats: 'offbeat' })
      darkDrums(env, rec, bars, { from: half, kick: 'four', fill: true })
    } else {
      arp(rec, 9)
      echo(rec)
      darkDrums(env, rec, bars, { from: half, kick: 'heart', fill: true })
    }
    impact(rec)
  })

  addSection(song, 'A', bars, 2, (rec) => {
    darkDrums(env, rec, bars, { kick: 'four', snare: true, hats: ebm ? '16' : 'offbeat', fill: true })
    writeBass(env, rec, 'fm1', prog, bars, bassA)
    pads(rec, 9)
    arp(rec, ebm ? 8 : 10)
    echo(rec)
    impact(rec)
  })

  addSection(song, 'B', bars, 2, (rec) => {
    darkDrums(env, rec, bars, { kick: 'four', snare: true, hats: ebm ? '16' : 'offbeat', anvil, buzz: ebm, fill: true })
    writeBass(env, rec, 'fm1', prog, bars, bassA)
    pads(rec, 9)
    arp(rec, 8)
    echo(rec, 5)
    merge(rec, lead)
    drone(rec)
  })

  addSection(song, 'BRK', bars, 1, (rec) => {
    pads(rec, 10, brkProg)
    drone(rec)
    arp(rec, 9, brkProg)
    echo(rec)
    merge(rec, leadBrk)
    // solo queda el latido; al final, tambores y redoble
    darkDrums(env, rec, bars, { kick: 'heart', to: bars - 1 })
    darkDrums(env, rec, bars, { from: bars - 1, kick: 'four', fill: true })
    roll(rec, (bars - 1) * spb, (bars - 1) * spb + Math.min(10, spb), DR.SNARE, 3, 11)
    impact(rec)
  })

  addSection(song, 'FINAL', bars, 2, (rec) => {
    darkDrums(env, rec, bars, { kick: 'four', snare: true, hats: '16', anvil, buzz: ebm, fill: true })
    writeBass(env, rec, 'fm1', prog, bars, bassB, { vel: 13 })
    pads(rec, 10)
    arp(rec, 9)
    echo(rec)
    merge(rec, lead)
    drone(rec)
    impact(rec)
  })

  addSection(song, 'OUTRO', bars, 1, (rec) => {
    const out = Math.max(1, bars - 2)
    darkDrums(env, rec, bars, { to: out, kick: ebm ? 'four' : 'heart', hats: 'offbeat' })
    writeBass(env, rec, 'fm1', prog, bars, bassA, { to: out, vel: 11 })
    pads(rec, 9)
    drone(rec)
    if (!ebm) {
      arp(rec, 8)
      echo(rec, 5)
    }
    impact(rec)
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  Entradas
// ═════════════════════════════════════════════════════════════════════════════
/** Rellena `song` (kit, pistas, patrones y orden) con un tema del estilo pedido. */
export interface ElectroOpts {
  cosmic?: CosmicOpts
  dark?: DarkGenOpts
}

export function generateElectro(song: Song, style: ElectroStyle, rng: Rng, bars: number, autoBpm: boolean, o: ElectroOpts = {}): void {
  const env = makeEnv(song, rng)
  if (style === 'cosmic') genCosmic(env, bars, o.cosmic)
  else if (style === 'minimal') genMinimal(env, bars)
  else genDark(env, bars, autoBpm, o.dark)
  song.loopStart = 1
}

/** progresión para "rellenar pista" (minimal y dark): la del estilo si la escala es menor; si no, grados diatónicos */
function fillProg(env: Env, style: ElectroStyle): Harm[] {
  const { rng, song } = env
  const minorish = env.scale.includes(3) && env.scale.includes(7)
  if (style === 'minimal') return [h(0, minorish ? 'min7' : 'power')]
  if (!minorish) {
    return [0, 4, 5, 3].map((deg) => {
      const c = diatonicChord(deg, 0, song.scale, 60)
      return h(mod12(c.root - 60), c.type)
    })
  }
  // las progresiones oscuras usan la segunda menor: solo si la escala la tiene
  const dark = [...DARK_PROGS.giallo, ...DARK_PROGS.ebm].filter((p) => env.scale.includes(1) || p.every((c) => c.root !== 1))
  return rng.pick(dark.length ? dark : [[h(0, 'min'), h(8, 'maj'), h(10, 'maj'), h(0, 'min')]])
}

/** Notas nuevas para una sola pista de un patrón, con el lenguaje del estilo. */
export function electroTrackNotes(song: Song, pat: Pattern, trackId: string, kind: FillKind, rng: Rng, style: ElectroStyle): Note[] {
  const env = makeEnv(song, rng)
  const { spb } = env
  const bars = pat.bars
  const total = bars * spb
  const tr = song.tracks.find((t) => t.id === trackId)
  const rec: NoteRec = {}
  let from = trackId
  const prog = style === 'cosmic' ? [] : fillProg(env, style)

  // cosmic tiene su propio lenguaje (cosmic.ts); minimal y dark comparten este reparto
  if (style === 'cosmic') from = cosmicFill(env, rec, trackId, kind, bars, tr?.kind === 'noise')
  else
    switch (kind) {
    case 'bass':
      if (style === 'minimal') writeBass(env, rec, trackId, prog, bars, rng.pick(MIN_BASS))
      else writeBass(env, rec, trackId, prog, bars, rng.pick([...DARK_BASS.ebm, ...DARK_BASS.giallo]))
      break
    case 'chords':
      if (style === 'minimal') {
        // el stab completo en una sola pista (el chip lo arpegia)
        const hits = grid(rng.pick(MIN_STABS))
        const voicing = rng.pick(STAB_VOICINGS)
        for (let b = 0; b < bars; b++) for (const g of hits) if (g.step < spb) for (const iv of voicing) put(rec, trackId, b * spb + g.step, 1, stabBase(env) + iv, 11)
      } else {
        let prev: number[] | null = null
        for (let b = 0; b < bars; b++) {
          const v = padVoices(env, prev, prog[b % prog.length], style === 'dark' ? 45 : 52, style === 'dark' ? 67 : 74)
          for (const n of v) put(rec, trackId, b * spb, spb, n, 10)
          prev = v
        }
      }
      break
    case 'arp':
      if (style === 'minimal') {
        const pool = rng.pick(MIN_POOLS[env.scale.includes(1) ? 'phrygian' : 'minor'])
        writePoly(env, rec, trackId, 0, total, rng.pick([3, 5, 6]), pool.map((p) => env.midTonic + 24 + p), 8)
      } else writeDarkArp(env, rec, trackId, prog, bars, { shape: rng.pick(DARK_ARPS), rate: rng.chance(0.7) ? 1 : 2, base: env.midTonic + 7, vel: 10 })
      break
    case 'lead':
      if (style === 'minimal') {
        const pool = rng.pick(MIN_POOLS[env.scale.includes(1) ? 'phrygian' : 'minor'])
        writeRiff(env, rec, trackId, makeRiff(rng, MIN_RIFFS, pool), bars, env.midTonic + 12, { vel: 12 })
      } else {
        writeMelody(env, rec, { track: trackId, lo: env.midTonic + 12, hi: env.midTonic + 27, rhythms: DARK_RHYTHMS, moves: [10, 30, 34, 8, 10, 3, 3, 1, 1], vel: 12 }, prog, bars)
      }
      break
    case 'drums':
      // el ritmo se escribe en ch6 (bombo, caja…) y en el ruido (charles): se devuelve la parte de la pista pedida
      if (style === 'minimal') technoDrums(env, rec, bars, { kick: true, hats: rng.chance(0.5) ? 'open' : 'closed', clap: rng.chance(0.5), rim: rng.pick(MIN_RIMS), air: 'shaker' })
      else darkDrums(env, rec, bars, { kick: 'four', snare: true, hats: rng.chance(0.5) ? '16' : 'offbeat', buzz: true, fill: true })
      from = tr?.kind === 'noise' ? 'noise' : 'ch6'
      break
    case 'perc':
      if (tr?.kind === 'noise') {
        if (style === 'minimal') technoDrums(env, rec, bars, { air: rng.chance(0.5) ? 'ride' : 'shaker' })
        else darkDrums(env, rec, bars, { buzz: true })
        from = 'noise'
      } else {
        if (style === 'minimal') technoDrums(env, rec, bars, { rim: rng.pick(MIN_RIMS), congas: rng.pick(MIN_CONGAS) })
        else darkDrums(env, rec, bars, { anvil: rng.pick([[3, 11], [7, 15], [0, 6, 11]]), fill: true })
        from = 'ch6'
      }
      break
  }

  // la batería solo tiene sentido en pistas de batería
  const drumKind = kind === 'drums' || kind === 'perc'
  if (drumKind && tr?.kind !== 'dac' && tr?.kind !== 'noise') return []
  const max = patternSteps(song, pat)
  return (rec[from] ?? [])
    .filter((n) => n.step < max)
    .map((n) => ({ ...n, len: Math.max(1, Math.min(n.len, max - n.step)) }))
    .sort((a, b) => a.step - b.step || a.note - b.note)
}
