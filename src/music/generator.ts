// ── Generador de temas chiptune ─────────────────────────────────────────────
//
// Genera canciones completas (varias secciones, 10 pistas) o regenera una sola
// pista de un patrón. Es determinista: misma semilla + opciones = mismo tema.
//
// Estilos:
//   cosmic     space disco serio y teatral, siempre en menor: progresiones con cadencia, tema por
//              ideas y secuencias, cuerdas y coro, timbales afinados (cosmic.ts)
//   minimal    techno minimal de Detroit: 909, riffs de campana, stabs y polirritmias
//   dark       oscuro: bajo EBM o pulso "giallo", coros graves, arpegio de terror, percusión industrial
//              (estos dos viven en electro.ts)
//   era        ADN TZOOTZ ERA001: Do menor, i–bVI–bVII–i, sus2, bajo sine, 606, hook de notas repetidas
//   adventure  tema de aventura / plataformas: mayor, arpegios brillantes, bajo "galope"
//   boss       jefe final: menor armónica / frigio, bajo en 16avos, arpegios rápidos
//   house      Streets-of-Rage: slap bass, stabs, bombo a negras, hats a contratiempo
//   fusion     jazz de arcade (Galaxy Force, Thunder Blade): vamp dórico con II–V, slap, saxo, vibráfono
//   swing      jazz con swing: bajo andante, guitarra, ride y escobillas (jazz.ts)
import { ELECTRO_BPM, electroTrackNotes, generateElectro, isElectro, type ElectroStyle } from './electro'
import {
  DR,
  FM,
  NZ,
  PSG,
  Rng,
  applyNotes,
  barStart,
  cellsOf,
  chordForDegree,
  grid,
  keyShift,
  put,
  putCells,
  setInstruments,
  tunePsg,
  v127,
  voiceChord,
  type BarChord,
  type Cell,
  type Ctx,
  type FillKind,
  type NoteRec,
} from './genkit'
import { JAZZ_BPM, generateJazz, isJazz, jazzTrackNotes, type JazzStyle } from './jazz'
import { createEmptySong } from './presets'
import type { Note, Pattern, Song } from './song'
import { MAX_BARS, emptyPattern, patternSteps, psgRecal, psgToHardware } from './song'
import { chordNotes, scaleById, scaleDegreeToMidi, type ChordType, type ScaleId } from './theory'

export { Rng } from './genkit'
export type { FillKind } from './genkit'

export type StyleId = ElectroStyle | JazzStyle | 'era' | 'adventure' | 'boss' | 'house'

export interface StyleInfo {
  id: StyleId
  name: string
  blurb: string
  bpm: [number, number]
  scale: ScaleId
}

export const STYLES: StyleInfo[] = [
  { id: 'cosmic', name: 'COSMIC DISCO', blurb: 'Space disco serio y teatral, siempre en menor: progresiones con cadencia, tema por secuencias, cuerdas y coro, timbales afinados', bpm: ELECTRO_BPM.cosmic, scale: 'minor' },
  { id: 'minimal', name: 'TECHNO MINIMAL', blurb: 'Detroit hipnótico: 909, riff de campana que se desfasa, stabs y polirritmias de 3 contra 4', bpm: ELECTRO_BPM.minimal, scale: 'minor' },
  { id: 'dark', name: 'DARK', blurb: 'Frigio oscuro: bajo EBM o pulso giallo, coros graves, arpegio de terror y percusión industrial', bpm: ELECTRO_BPM.dark, scale: 'phrygian' },
  { id: 'era', name: 'TZOOTZ ERA', blurb: 'Do menor, sus2, i–bVI–bVII–i, bajo sine, 606 y hook de notas repetidas', bpm: [108, 116], scale: 'minor' },
  { id: 'adventure', name: 'AVENTURA', blurb: 'Tema de plataformas: mayor, arpegios brillantes, bajo galope', bpm: [136, 152], scale: 'major' },
  { id: 'boss', name: 'JEFE FINAL', blurb: 'Menor armónica/frigio, bajo en 16avos, arpegios rápidos', bpm: [156, 172], scale: 'harmonicMinor' },
  { id: 'house', name: 'HOUSE 1992', blurb: 'Slap bass, stabs, bombo a negras y hats a contratiempo', bpm: [120, 128], scale: 'dorian' },
  { id: 'fusion', name: 'JAZZ FUSION', blurb: 'Jazz de arcade: vamp dórico con II–V, bajo slap, teclado a tres voces vibráfono arriba, saxo y batería de rock ligero', bpm: JAZZ_BPM.fusion, scale: 'dorian' },
  { id: 'swing', name: 'JAZZ SWING', blurb: 'Corchea con swing 2:1 a tempo de negra (♩ = 132–168): bajo andante, guitarra, vibráfono, saxo y ride; II–V–I con alteradas', bpm: JAZZ_BPM.swing, scale: 'major' },
]

export interface GenOptions {
  style: StyleId
  seed: number
  /** tónica 0-11 (0 = Do) */
  key: number
  bpm?: number
  /** compases por sección (por defecto 8) */
  bars?: number
}

// ── material ERA (Do menor) — del análisis de los sets de ERA001 ─────────────

const ERA_VOICINGS: Record<string, number[]> = {
  sus2: [48, 55, 62, 67, 72],
  m9: [48, 55, 62, 63, 67],
  m: [48, 55, 60, 63, 67],
  AbMaj7: [44, 51, 60, 63, 67],
  Ab: [44, 51, 60, 63, 68],
  Bbsus2: [46, 53, 60, 65, 70],
  Bb: [46, 53, 62, 65, 70],
  Bdim: [47, 53, 62, 65],
  Fm: [41, 48, 56, 60, 65],
  DbC: [48, 56, 61, 65, 68],
}

/** compás a compás: nombre del voicing y raíz del bajo (en Do) */
const ERA_L1: [string, number][] = [
  ['sus2', 36],
  ['AbMaj7', 32],
  ['Bbsus2', 34],
  ['m9', 36],
]
const ERA_L2: [string, number][] = [
  ['m', 36],
  ['Ab', 32],
  ['Bbsus2', 34],
  ['m9', 36],
  ['Fm', 29],
  ['Ab', 32],
  ['Bbsus2', 34],
  ['Bbsus2', 34],
]
const ERA_BREAK: [string, number][] = [
  ['m9', 36],
  ['DbC', 36],
  ['m9', 36],
  ['DbC', 36],
  ['m9', 36],
  ['DbC', 36],
  ['Ab', 32],
  ['Bbsus2', 34],
]

const ERA_BASS_A: Cell[] = [
  { s: 0, l: 5, p: 0, v: 112 },
  { s: 7, l: 1, p: 0, v: 84 },
  { s: 10, l: 3, p: 0, v: 104 },
  { s: 14, l: 2, p: 99, v: 96 }, // 99 = raíz del compás siguiente
]
const ERA_BASS_B: Cell[] = [
  { s: 0, l: 3, p: 0, v: 112 },
  { s: 3, l: 1, p: 0, v: 82 },
  { s: 6, l: 2, p: 12, v: 96 },
  { s: 8, l: 3, p: 0, v: 106 },
  { s: 12, l: 2, p: 7, v: 92 },
  { s: 14, l: 2, p: 99, v: 98 },
]
const ERA_BASS_BREAK: Cell[] = [
  { s: 0, l: 6, p: 0, v: 96 },
  { s: 8, l: 4, p: 0, v: 88 },
  { s: 14, l: 2, p: 12, v: 78 },
]

const HOOK_A: Cell[][] = [
  [
    { s: 0, l: 2, p: 67 },
    { s: 2, l: 1, p: 67 },
    { s: 3, l: 1, p: 67 },
    { s: 4, l: 2, p: 68 },
    { s: 6, l: 2, p: 67 },
    { s: 8, l: 2, p: 65 },
    { s: 10, l: 2, p: 63 },
    { s: 12, l: 4, p: 65 },
  ],
  [
    { s: 0, l: 2, p: 67 },
    { s: 2, l: 1, p: 67 },
    { s: 3, l: 1, p: 67 },
    { s: 4, l: 2, p: 70 },
    { s: 6, l: 2, p: 68 },
    { s: 8, l: 6, p: 67 },
  ],
  [
    { s: 0, l: 2, p: 72 },
    { s: 2, l: 1, p: 72 },
    { s: 3, l: 1, p: 72 },
    { s: 4, l: 2, p: 73 },
    { s: 6, l: 2, p: 72 },
    { s: 8, l: 2, p: 70 },
    { s: 10, l: 2, p: 68 },
    { s: 12, l: 4, p: 67 },
  ],
  [
    { s: 0, l: 2, p: 68 },
    { s: 2, l: 2, p: 67 },
    { s: 4, l: 2, p: 65 },
    { s: 6, l: 2, p: 63 },
    { s: 8, l: 4, p: 62 },
    { s: 12, l: 2, p: 63 },
    { s: 14, l: 2, p: 60 },
  ],
]
const HOOK_B: Cell[][] = [
  [
    { s: 0, l: 2, p: 72 },
    { s: 2, l: 1, p: 72 },
    { s: 3, l: 1, p: 72 },
    { s: 4, l: 2, p: 70 },
    { s: 6, l: 2, p: 68 },
    { s: 8, l: 2, p: 67 },
    { s: 10, l: 2, p: 68 },
    { s: 12, l: 4, p: 65 },
  ],
  [
    { s: 0, l: 2, p: 75 },
    { s: 2, l: 1, p: 75 },
    { s: 3, l: 1, p: 75 },
    { s: 4, l: 2, p: 73 },
    { s: 6, l: 2, p: 72 },
    { s: 8, l: 2, p: 70 },
    { s: 10, l: 2, p: 72 },
    { s: 12, l: 4, p: 68 },
  ],
  [
    { s: 0, l: 2, p: 70 },
    { s: 2, l: 1, p: 70 },
    { s: 3, l: 1, p: 70 },
    { s: 4, l: 2, p: 72 },
    { s: 6, l: 2, p: 70 },
    { s: 8, l: 2, p: 68 },
    { s: 10, l: 2, p: 67 },
    { s: 12, l: 4, p: 65 },
  ],
  [
    { s: 0, l: 2, p: 68 },
    { s: 2, l: 2, p: 67 },
    { s: 4, l: 2, p: 65 },
    { s: 6, l: 2, p: 63 },
    { s: 8, l: 2, p: 62 },
    { s: 10, l: 2, p: 65 },
    { s: 12, l: 2, p: 62 },
    { s: 14, l: 2, p: 59 },
  ],
]

/** motivos de solo (frigio de Do), cada uno de 1 compás */
const ERA_SOLO: Cell[][] = [
  [
    { s: 4, l: 2, p: 67 },
    { s: 6, l: 1, p: 68 },
    { s: 7, l: 1, p: 67 },
    { s: 8, l: 2, p: 65 },
    { s: 10, l: 2, p: 63 },
    { s: 12, l: 1, p: 61 },
    { s: 13, l: 3, p: 60 },
  ],
  [
    { s: 0, l: 1, p: 60 },
    { s: 1, l: 1, p: 61 },
    { s: 2, l: 1, p: 63 },
    { s: 3, l: 1, p: 65 },
    { s: 4, l: 1, p: 67 },
    { s: 5, l: 1, p: 68 },
    { s: 6, l: 1, p: 70 },
    { s: 7, l: 1, p: 72 },
    { s: 8, l: 2, p: 73 },
    { s: 10, l: 2, p: 72 },
    { s: 12, l: 2, p: 70 },
    { s: 14, l: 2, p: 67 },
  ],
  [
    { s: 0, l: 2, p: 72 },
    { s: 2, l: 1, p: 72 },
    { s: 3, l: 1, p: 72 },
    { s: 4, l: 1, p: 73 },
    { s: 5, l: 1, p: 72 },
    { s: 6, l: 1, p: 70 },
    { s: 7, l: 1, p: 72 },
    { s: 10, l: 2, p: 67 },
    { s: 12, l: 2, p: 68 },
    { s: 14, l: 2, p: 67 },
  ],
  [
    { s: 0, l: 1, p: 75 },
    { s: 1, l: 1, p: 73 },
    { s: 2, l: 1, p: 72 },
    { s: 3, l: 1, p: 70 },
    { s: 4, l: 1, p: 72 },
    { s: 5, l: 1, p: 70 },
    { s: 6, l: 1, p: 68 },
    { s: 7, l: 1, p: 67 },
    { s: 8, l: 1, p: 68 },
    { s: 9, l: 1, p: 67 },
    { s: 10, l: 1, p: 65 },
    { s: 11, l: 1, p: 63 },
    { s: 12, l: 2, p: 65 },
    { s: 14, l: 1, p: 63 },
    { s: 15, l: 1, p: 61 },
  ],
  [
    { s: 0, l: 2, p: 79 },
    { s: 2, l: 1, p: 79 },
    { s: 3, l: 1, p: 77 },
    { s: 4, l: 2, p: 75 },
    { s: 6, l: 2, p: 73 },
    { s: 8, l: 4, p: 72 },
    { s: 12, l: 2, p: 70 },
    { s: 14, l: 2, p: 72 },
  ],
]

// ═════════════════════════════════════════════════════════════════════════════
//  ERA
// ═════════════════════════════════════════════════════════════════════════════
type EraProg = [string, number][]

function eraProgFor(section: string, bars: number): EraProg {
  const base = section === 'BRK' ? ERA_BREAK : section === 'INTRO' ? [...ERA_L1, ...ERA_L1] : ERA_L2
  const out: EraProg = []
  for (let i = 0; i < bars; i++) out.push(base[i % base.length])
  return out
}

function eraDrums(ctx: Ctx, rec: NoteRec, bars: number, level: 'none' | 'soft' | 'full', variant: number): void {
  const spb = ctx.spb
  for (let b = 0; b < bars; b++) {
    const at = barStart(ctx, b)
    const odd = b % 2 === 0
    if (level === 'none') continue
    // bombo
    const kick = odd ? 'X.X.|....|..X.|....' : 'X.X.|....|..X.|..XX'
    const kickFinal = 'X.X.|...X|..X.|..X.'
    const useAlt = variant > 0 && b % 4 === 3
    if (level === 'full') {
      for (const g of grid(useAlt ? kickFinal : kick)) put(rec, 'ch6', at + g.step, 1, DR.KICK, g.vel)
      for (const g of grid('....|X...|....|X...')) put(rec, 'ch6', at + g.step, 1, DR.SNARE, 15)
      for (const s of odd ? [7, 9] : [9, 15]) put(rec, 'ch6', at + s, 1, DR.RIM, 5)
    } else {
      for (const s of [0, 8]) put(rec, 'ch6', at + s, 1, DR.KICK, 9)
    }
    // hats: cerrado en pares, abierto en la 14 de los compases pares
    for (let s = 0; s < spb; s++) {
      if (level === 'soft' && s % 4 !== 0 && s % 4 !== 2) continue
      const accent = s % 4 === 0 ? 13 : s % 2 === 0 ? 9 : 5
      if (!odd && s === 14) put(rec, 'ch6', at + s, 2, DR.OPEN, 10)
      else if (!(!odd && s === 15)) put(rec, 'ch6', at + s, 1, DR.HAT, accent)
    }
    // relleno de toms al final de cada frase de 8
    if (level === 'full' && b % 8 === 7) {
      put(rec, 'ch6', at + 12, 1, DR.TOM_HI, 12)
      put(rec, 'ch6', at + 13, 1, DR.TOM_HI, 11)
      put(rec, 'ch6', at + 14, 1, DR.TOM_LO, 12)
      put(rec, 'ch6', at + 15, 1, DR.TOM_LO, 14)
    }
  }
}

function eraPerc(ctx: Ctx, rec: NoteRec, bars: number, density: number): void {
  for (let b = 0; b < bars; b++) {
    const at = barStart(ctx, b)
    // shaker (noise): oxox
    if (density >= 1) {
      for (let s = 0; s < ctx.spb; s += 2) put(rec, 'noise', at + s, 1, NZ.HAT, s % 4 === 0 ? 6 : 9)
    }
    // tumbao: toms muy suaves + clave (rim) 3-2
    if (density >= 2) {
      for (const g of grid('o.o.|..o.|o.o.|....')) put(rec, 'ch6', at + g.step, 1, DR.TOM_HI, 5)
      for (const g of grid('....|..o.|..o.|....')) put(rec, 'ch6', at + g.step, 1, DR.TOM_LO, 5)
      const clave = b % 2 === 0 ? 'X...|..X.|....|X...' : '....|X...|X...|....'
      for (const g of grid(clave)) put(rec, 'ch6', at + g.step, 1, DR.RIM, 9)
    }
  }
}

function eraBass(ctx: Ctx, rec: NoteRec, prog: EraProg, pattern: Cell[]): void {
  const tr = ctx.tr
  for (let b = 0; b < prog.length; b++) {
    const at = barStart(ctx, b)
    const root = prog[b][1] + tr
    const next = (prog[(b + 1) % prog.length][1] ?? root) + tr
    for (const c of pattern) {
      const p = c.p === 99 ? next : root + c.p
      put(rec, 'fm1', at + c.s, c.l, p, v127(c.v ?? 100))
    }
  }
}

function eraChords(ctx: Ctx, rec: NoteRec, prog: EraProg, mode: 'sustain' | 'push', solina: boolean, transposeNotes = 0): void {
  const tr = ctx.tr
  for (let b = 0; b < prog.length; b++) {
    const at = barStart(ctx, b)
    const v = ERA_VOICINGS[prog[b][0]] ?? ERA_VOICINGS.m
    const last = b % 4 === 3
    const events: [number, number][] =
      mode === 'push' ? [[0, last ? 10 : 10], [10, 6]] : [[0, ctx.spb]]
    for (const [s, l] of events) {
      for (const n of v) put(rec, 'fm2', at + s, l, n + tr + transposeNotes, s === 0 ? 11 : 9)
      if (solina) for (const n of v.slice(1)) put(rec, 'fm3', at + s, l, n + 12 + tr, 8)
    }
  }
}

function eraOrgan(ctx: Ctx, rec: NoteRec, prog: EraProg): void {
  const skank: Record<string, number[]> = {
    m: [63, 67, 72],
    m9: [63, 67, 72],
    Ab: [63, 68, 72],
    AbMaj7: [63, 68, 72],
    Bbsus2: [65, 70, 72],
    Fm: [65, 68, 72],
    Bdim: [62, 65, 71],
    sus2: [62, 67, 72],
    DbC: [61, 65, 68],
  }
  for (let b = 0; b < prog.length; b++) {
    const at = barStart(ctx, b)
    const v = skank[prog[b][0]] ?? skank.m
    for (const s of [2, 6, 10, 14]) for (const n of v) put(rec, 'fm5', at + s, 1, n + ctx.tr, 8)
  }
}

function eraHook(ctx: Ctx, rec: NoteRec, bars: number, variant: number, octave = 0): void {
  const tr = ctx.tr
  const phraseA = HOOK_A.slice()
  const phraseB = HOOK_B.slice()
  for (let b = 0; b < bars; b++) {
    const at = barStart(ctx, b)
    const half = Math.floor(b / 4) % 2 === 0
    const src = (half ? phraseA : phraseB)[b % 4]
    // pequeña variación determinista: última nota del compás 4 de cada frase puede subir 2 semitonos
    const cells = src.map((c, i) => {
      if (variant > 0 && i === src.length - 1 && b % 4 === 1 && ctx.rng.chance(0.5)) return { ...c, p: c.p + 2 }
      return c
    })
    putCells(rec, 'fm4', cells, at, tr + octave, 12)
    // eco en SQ2: copia retrasada 3 pasos, más suave
    for (const c of cells) {
      const s = c.s + 3
      if (s < ctx.spb) put(rec, 'sq2', at + s, Math.min(c.l, ctx.spb - s), c.p + tr + octave + 12, 6)
    }
  }
}

function eraSolo(ctx: Ctx, rec: NoteRec, bars: number, seedOffset: number): void {
  const tr = ctx.tr
  const order = [0, 1, 2, 3, 0, 4, 3, 2]
  for (let b = 0; b < bars; b++) {
    const m = ERA_SOLO[order[(b + seedOffset) % order.length]]
    const at = barStart(ctx, b)
    putCells(rec, 'sq1', m, at, tr, 12)
  }
}

function eraPadSq(ctx: Ctx, rec: NoteRec, prog: EraProg): void {
  // SQ3: nota larga de la tercera/quinta del acorde (pad suave)
  for (let b = 0; b < prog.length; b += 1) {
    const v = ERA_VOICINGS[prog[b][0]] ?? ERA_VOICINGS.m
    const at = barStart(ctx, b)
    put(rec, 'sq3', at, ctx.spb, v[2] + ctx.tr + 12, 5)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Estilos genéricos (progresiones por grados + melodía algorítmica)
// ═════════════════════════════════════════════════════════════════════════════
interface ProgDef {
  /** grados de la escala (0-6) o semitonos prefijados con "s" no soportado; usamos [grado, tipo] */
  chords: [number, ChordType][]
}

interface GenericStyle {
  scale: ScaleId
  progs: ProgDef[]
  bassRhythms: Cell[][]
  chordMode: 'sustain' | 'stab' | 'arp'
  drumSet: 'adventure' | 'boss' | 'house'
  leadFm: number
  bassFm: number
  chordFm: number
  padFm: number
  arpPsg: number
  leadRange: [number, number]
  leadCells: { s: number; l: number }[][]
}

type GenericId = Exclude<StyleId, 'era' | ElectroStyle | JazzStyle>

const GENERIC: Record<GenericId, GenericStyle> = {
  adventure: {
    scale: 'major',
    progs: [
      { chords: [[0, 'maj'], [4, 'maj'], [5, 'min'], [3, 'maj']] },
      { chords: [[0, 'maj'], [5, 'min'], [3, 'maj'], [4, 'maj']] },
      { chords: [[0, 'maj'], [3, 'maj'], [4, 'maj'], [3, 'maj']] },
      { chords: [[1, 'min'], [4, 'maj'], [0, 'maj'], [5, 'min']] },
    ],
    bassRhythms: [
      [
        { s: 0, l: 2, p: 0 },
        { s: 2, l: 2, p: 7 },
        { s: 4, l: 2, p: 0 },
        { s: 6, l: 2, p: 7 },
        { s: 8, l: 2, p: 0 },
        { s: 10, l: 2, p: 7 },
        { s: 12, l: 2, p: 0 },
        { s: 14, l: 2, p: 7 },
      ],
      [
        { s: 0, l: 3, p: 0 },
        { s: 3, l: 1, p: 0 },
        { s: 4, l: 2, p: 7 },
        { s: 8, l: 3, p: 0 },
        { s: 11, l: 1, p: 12 },
        { s: 12, l: 2, p: 7 },
        { s: 14, l: 2, p: 5 },
      ],
    ],
    chordMode: 'arp',
    drumSet: 'adventure',
    leadFm: FM.BRASS,
    bassFm: FM.SLAP,
    chordFm: FM.EPIANO,
    padFm: FM.STRINGS,
    arpPsg: PSG.ARP,
    leadRange: [64, 88],
    leadCells: [
      cellsOf('0:2,2:1,3:1,4:2,6:2,8:4,12:2,14:2'),
      cellsOf('0:1,1:1,2:2,4:2,6:2,8:2,10:2,12:4'),
      cellsOf('0:3,3:1,4:2,6:2,8:3,11:1,12:4'),
      cellsOf('0:2,2:2,4:1,5:1,6:2,8:2,10:1,11:1,12:4'),
    ],
  },
  boss: {
    scale: 'harmonicMinor',
    progs: [
      { chords: [[0, 'min'], [0, 'min'], [5, 'maj'], [4, 'maj']] },
      { chords: [[0, 'min'], [6, 'dim'], [0, 'min'], [4, 'dom7']] },
      { chords: [[0, 'min'], [3, 'min'], [4, 'maj'], [0, 'min']] },
      { chords: [[0, 'min'], [5, 'maj'], [6, 'dim'], [4, 'maj']] },
    ],
    bassRhythms: [
      cellsOf('0:1,1:1,2:1,3:1,4:1,5:1,6:1,7:1,8:1,9:1,10:1,11:1,12:1,13:1,14:1,15:1'),
      [
        { s: 0, l: 1, p: 0 },
        { s: 1, l: 1, p: 0 },
        { s: 2, l: 1, p: 12 },
        { s: 3, l: 1, p: 0 },
        { s: 4, l: 1, p: 0 },
        { s: 5, l: 1, p: 0 },
        { s: 6, l: 1, p: 12 },
        { s: 7, l: 1, p: 0 },
        { s: 8, l: 1, p: 0 },
        { s: 9, l: 1, p: 0 },
        { s: 10, l: 1, p: 12 },
        { s: 11, l: 1, p: 0 },
        { s: 12, l: 1, p: 7 },
        { s: 13, l: 1, p: 7 },
        { s: 14, l: 1, p: 5 },
        { s: 15, l: 1, p: 3 },
      ],
    ],
    chordMode: 'arp',
    drumSet: 'boss',
    leadFm: FM.SAW,
    bassFm: FM.GROWL,
    chordFm: FM.BRASS,
    padFm: FM.CHOIR,
    arpPsg: PSG.ARP,
    leadRange: [66, 90],
    leadCells: [
      cellsOf('0:1,1:1,2:1,3:1,4:2,6:2,8:1,9:1,10:1,11:1,12:4'),
      cellsOf('0:2,2:1,3:1,4:1,5:1,6:2,8:2,10:1,11:1,12:2,14:2'),
      cellsOf('0:1,1:1,2:2,4:1,5:1,6:2,8:1,9:1,10:2,12:2,14:1,15:1'),
    ],
  },
  house: {
    scale: 'dorian',
    progs: [
      { chords: [[0, 'min7'], [0, 'min7'], [3, 'dom7'], [3, 'dom7']] },
      { chords: [[0, 'min7'], [6, 'maj'], [5, 'maj7'], [6, 'maj']] },
      { chords: [[0, 'min7'], [3, 'min7'], [0, 'min7'], [4, 'min7']] },
    ],
    bassRhythms: [
      cellsOf('0:2,3:1,6:1,8:2,11:1,14:2'),
      cellsOf('0:1,3:1,4:1,7:1,10:1,12:1,14:2'),
      cellsOf('0:3,4:1,6:1,8:3,12:1,14:1,15:1'),
    ],
    chordMode: 'stab',
    drumSet: 'house',
    leadFm: FM.SQUARE,
    bassFm: FM.SLAP,
    chordFm: FM.EPIANO,
    padFm: FM.STRINGS,
    arpPsg: PSG.STAB,
    leadRange: [64, 86],
    leadCells: [
      cellsOf('0:2,3:1,6:2,10:2,13:2'),
      cellsOf('2:2,5:1,8:2,11:1,14:2'),
      cellsOf('0:1,3:2,6:1,8:2,12:3'),
    ],
  },
}

function genericBass(ctx: Ctx, rec: NoteRec, st: GenericStyle, rhythm: Cell[], track: string, octaveBase: number, bars: number): void {
  const tonic = ctx.key
  for (let b = 0; b < bars; b++) {
    const c = ctx.prog[b % ctx.prog.length]
    const next = ctx.prog[(b + 1) % ctx.prog.length]
    let root = tonic + c.root + octaveBase
    while (root > octaveBase + 12 + tonic) root -= 12
    while (root < octaveBase + tonic - 1) root += 12
    const nextRoot = tonic + next.root + octaveBase
    const at = barStart(ctx, b)
    for (const cell of rhythm) {
      let p = root + cell.p
      if (cell.s >= ctx.spb - 2 && cell.p === 5 && ctx.rng.chance(0.6)) p = nextRoot
      put(rec, track, at + cell.s, cell.l, p, cell.s % 4 === 0 ? 14 : 11)
    }
  }
  void st
}

function genericChords(ctx: Ctx, rec: NoteRec, st: GenericStyle, bars: number): void {
  const tonicMid = 60 + ctx.key
  for (let b = 0; b < bars; b++) {
    const c = ctx.prog[b % ctx.prog.length]
    const at = barStart(ctx, b)
    const notes = voiceChord(tonicMid - 12, c, 55)
    if (st.chordMode === 'stab') {
      for (const s of [2, 6, 10, 14]) for (const n of notes) put(rec, 'fm2', at + s, 1, n, s === 6 || s === 14 ? 10 : 12)
    } else if (st.chordMode === 'sustain') {
      for (const n of notes) put(rec, 'fm2', at, ctx.spb, n, 11)
    } else {
      // acordes de FM en blancas, el arpegio va en PSG
      for (const n of notes) put(rec, 'fm2', at, ctx.spb / 2, n, 10)
      for (const n of notes) put(rec, 'fm2', at + ctx.spb / 2, ctx.spb / 2, n, 9)
    }
    // pad: acorde largo una octava arriba en FM5
    for (const n of notes.slice(0, 3)) put(rec, 'fm5', at, ctx.spb, n + 12, 8)
  }
}

function genericArp(ctx: Ctx, rec: NoteRec, bars: number, track: string, rate: 1 | 2, shape: 'up' | 'updown' | 'skip'): void {
  const tonicMid = 60 + ctx.key
  for (let b = 0; b < bars; b++) {
    const c = ctx.prog[b % ctx.prog.length]
    const at = barStart(ctx, b)
    const base = voiceChord(tonicMid, c, 60)
    const tones = [...base, base[0] + 12]
    const seq: number[] = []
    if (shape === 'up') for (let i = 0; i < 16; i++) seq.push(tones[i % tones.length])
    else if (shape === 'updown') {
      const ud = [...tones, ...tones.slice(1, -1).reverse()]
      for (let i = 0; i < 16; i++) seq.push(ud[i % ud.length])
    } else for (let i = 0; i < 16; i++) seq.push(tones[(i * 2) % tones.length])
    for (let s = 0; s < ctx.spb; s += rate) put(rec, track, at + s, rate, seq[s % seq.length], s % 4 === 0 ? 12 : 9)
  }
}

/** melodía algorítmica sobre la escala, con notas de acorde en tiempos fuertes */
function genericLead(ctx: Ctx, rec: NoteRec, st: GenericStyle, bars: number, track: string, phraseBars = 4): void {
  const { rng } = ctx
  const steps = scaleById(ctx.scale).steps
  const len = steps.length
  const baseMidi = 60 + ctx.key
  const toMidi = (deg: number): number => scaleDegreeToMidi(deg, ctx.key, ctx.scale, 60)
  void baseMidi
  const [lo, hi] = st.leadRange
  // grado actual dentro de la escala (empieza en la quinta)
  let deg = 4 + len
  let motif: { s: number; l: number; d: number }[] | null = null
  for (let b = 0; b < bars; b++) {
    const at = barStart(ctx, b)
    const chord = ctx.prog[b % ctx.prog.length]
    const chordPcs = chordNotes(0, chord.type).map((n) => (n + chord.root) % 12)
    const phrasePos = b % phraseBars
    // segunda mitad de la frase repite el motivo del primero con ligera variación
    if (phrasePos === 0 || !motif || (phrasePos === phraseBars / 2 && rng.chance(0.3))) {
      const cell = rng.pick(st.leadCells)
      let cur = deg
      motif = cell.map((c, i) => {
        const strong = c.s % 8 === 0
        if (i > 0) {
          const move = [0, 1, -1, 2, -2, 3, -3][rng.weighted([22, 26, 26, 8, 8, 5, 5])]
          cur += move
        }
        if (strong) {
          // lleva el grado a la nota de acorde más cercana
          for (let k = 0; k <= 3; k++) {
            const cand = [cur + k, cur - k].find((d) => {
              const pc = (((steps[((d % len) + len) % len] + 0) % 12) + 12) % 12
              return chordPcs.includes(pc)
            })
            if (cand !== undefined) {
              cur = cand
              break
            }
          }
        }
        return { s: c.s, l: c.l, d: cur }
      })
      deg = cur
    }
    for (const m of motif) {
      let midi = toMidi(m.d)
      while (midi < lo) midi += 12
      while (midi > hi) midi -= 12
      put(rec, track, at + m.s, m.l, midi, m.s % 4 === 0 ? 13 : 10)
    }
    // final de frase: nota larga en la tónica
    if (phrasePos === phraseBars - 1 && motif.length) {
      const last = motif[motif.length - 1]
      const tonic = toMidi(len * 2)
      let midi = tonic
      while (midi < lo) midi += 12
      while (midi > hi) midi -= 12
      const arr = rec[track] ?? []
      const idx = arr.findIndex((n) => n.step === at + last.s)
      if (idx >= 0) {
        arr[idx].note = midi
        arr[idx].len = Math.max(arr[idx].len, 2)
      }
      deg = len * 2 + 2
    }
  }
}

function genericDrums(ctx: Ctx, rec: NoteRec, set: GenericStyle['drumSet'], bars: number, intensity: 'soft' | 'full', fill: boolean): void {
  for (let b = 0; b < bars; b++) {
    const at = barStart(ctx, b)
    const lastBar = b % 4 === 3
    const put1 = (s: number, drum: number, vel: number, len = 1): void => put(rec, 'ch6', at + s, len, drum, vel)
    if (set === 'house') {
      for (const s of [0, 4, 8, 12]) put1(s, DR.KICK, s === 0 ? 15 : 13)
      if (intensity === 'full') for (const s of [4, 12]) put1(s, DR.CLAP, 14)
      for (const s of [2, 6, 10, 14]) put1(s, DR.HAT, s === 6 || s === 14 ? 8 : 11)
      if (intensity === 'full' && !lastBar) put1(15, DR.OPEN, 8)
      if (intensity === 'full') for (const s of [7, 13]) put1(s, DR.RIM, 5)
    } else if (set === 'boss') {
      const k = lastBar ? 'X.X.|X.X.|X.X.|XXXX' : 'X.X.|..X.|X.X.|..X.'
      for (const g of grid(k)) put1(g.step, DR.KICK, g.vel)
      for (const s of [4, 12]) put1(s, DR.SNARE, 15)
      for (let s = 0; s < 16; s += 2) put1(s, DR.HAT, s % 4 === 0 ? 12 : 8)
      if (intensity === 'full' && lastBar) for (const [s, d] of [[8, DR.TOM_HI], [10, DR.TOM_HI], [12, DR.TOM_LO], [14, DR.TOM_LO]] as const) put1(s, d, 13)
    } else {
      for (const s of [0, 8]) put1(s, DR.KICK, 15)
      if (b % 2 === 1) put1(11, DR.KICK, 11)
      for (const s of [4, 12]) put1(s, DR.SNARE, 14)
      for (let s = 0; s < 16; s += 2) put1(s, DR.HAT, s % 4 === 0 ? 11 : 7)
      if (fill && lastBar) for (const s of [13, 14, 15]) put1(s, DR.SNARE, 10 + (s - 13))
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Ensamblado de la canción
// ═════════════════════════════════════════════════════════════════════════════
interface SectionPlan {
  name: string
  repeat: number
}

/**
 * COSMIC DISCO escribe ya sus pistas de PSG para la calibración de hardware. El resto de los
 * estilos se compuso con el PSG 7,5 dB más alto y se traslada al final con psgToHardware().
 */
const nativePsg = (style: StyleId): boolean => style === 'cosmic'

export function generateSong(opts: GenOptions): Song {
  const song = composeSong(opts)
  if (!nativePsg(opts.style)) psgToHardware(song)
  return song
}

function composeSong(opts: GenOptions): Song {
  const rng = new Rng(opts.seed * 7919 + opts.style.length * 131)
  const song = createEmptySong()
  const info = STYLES.find((s) => s.id === opts.style) ?? STYLES[0]
  song.bpm = opts.bpm ?? rng.int(info.bpm[0], info.bpm[1])
  song.key = opts.key
  song.scale = info.scale
  const bars = opts.bars ?? 8
  const spb = song.beatsPerBar * 4

  const ctx: Ctx = { rng, song, key: opts.key, scale: info.scale, spb, tr: keyShift(opts.key), prog: [] }
  song.patterns = []
  song.order = []

  if (isElectro(opts.style)) {
    song.title = `${info.name} ${String(opts.seed % 10000).padStart(4, '0')}`
    generateElectro(song, opts.style, rng, bars, opts.bpm === undefined)
    return song
  }

  if (isJazz(opts.style)) {
    song.title = `${info.name} ${String(opts.seed % 10000).padStart(4, '0')}`
    generateJazz(song, opts.style, rng, bars, opts.bpm === undefined)
    return song
  }

  if (opts.style === 'era') {
    setInstruments(song, { fm1: FM.SUB, fm2: FM.RHODES, fm3: FM.STRINGS, fm4: FM.MALLET, fm5: FM.ORGAN, sq1: PSG.LEAD, sq2: PSG.ECHO, sq3: PSG.PAD })
    song.title = `ERA ${String(opts.seed % 10000).padStart(4, '0')}`
    const plan: SectionPlan[] = [
      { name: 'INTRO', repeat: 1 },
      { name: 'A', repeat: 2 },
      { name: 'B', repeat: 2 },
      { name: 'BRK', repeat: 1 },
      { name: 'FINAL', repeat: 2 },
      { name: 'OUTRO', repeat: 1 },
    ]
    const variant = rng.int(0, 1)
    const soloOffset = rng.int(0, 4)
    for (const sec of plan) {
      const pat = emptyPattern(song, bars, sec.name)
      const rec: NoteRec = {}
      const prog = eraProgFor(sec.name, bars)
      switch (sec.name) {
        case 'INTRO':
          eraChords(ctx, rec, prog, 'sustain', true)
          eraPerc(ctx, rec, bars, 1)
          eraDrums(ctx, rec, bars, 'none', 0)
          // hats suaves desde el compás 5
          for (let b = 4; b < bars; b++) for (let s = 0; s < spb; s += 4) put(rec, 'ch6', barStart(ctx, b) + s, 1, DR.HAT, 5)
          // redoble de caja en el último compás
          for (let s = 0; s < spb; s++) put(rec, 'ch6', barStart(ctx, bars - 1) + s, 1, DR.SNARE, 4 + Math.round((s / spb) * 10))
          break
        case 'A':
          eraDrums(ctx, rec, bars, 'full', variant)
          eraPerc(ctx, rec, bars, 2)
          eraBass(ctx, rec, prog, ERA_BASS_A)
          eraChords(ctx, rec, prog, 'sustain', false)
          eraPadSq(ctx, rec, prog)
          break
        case 'B':
          eraDrums(ctx, rec, bars, 'full', 1)
          eraPerc(ctx, rec, bars, 2)
          eraBass(ctx, rec, prog, ERA_BASS_B)
          eraChords(ctx, rec, prog, 'push', false)
          eraOrgan(ctx, rec, prog)
          eraHook(ctx, rec, bars, variant)
          break
        case 'BRK':
          eraDrums(ctx, rec, bars, 'soft', 0)
          eraBass(ctx, rec, prog, ERA_BASS_BREAK)
          eraChords(ctx, rec, prog, 'sustain', true)
          eraSolo(ctx, rec, bars, soloOffset)
          eraPadSq(ctx, rec, prog)
          break
        case 'FINAL':
          eraDrums(ctx, rec, bars, 'full', 1)
          eraPerc(ctx, rec, bars, 2)
          eraBass(ctx, rec, prog, ERA_BASS_B)
          eraChords(ctx, rec, prog, 'push', true)
          eraOrgan(ctx, rec, prog)
          eraHook(ctx, rec, bars, 1)
          eraSolo(ctx, rec, bars, soloOffset + 1)
          break
        default:
          eraDrums(ctx, rec, bars, 'soft', 0)
          eraBass(ctx, rec, prog, [{ s: 0, l: 16, p: 0, v: 100 }])
          eraChords(ctx, rec, prog, 'sustain', true)
          break
      }
      applyNotes(song, pat, rec)
      song.patterns.push(pat)
      for (let r = 0; r < sec.repeat; r++) song.order.push(pat.id)
    }
    song.loopStart = 1
    song.scale = 'minor'
    return song
  }

  // ── estilos genéricos ──
  const st = GENERIC[opts.style]
  song.scale = st.scale
  song.title = `${info.name} ${String(opts.seed % 10000).padStart(4, '0')}`
  setInstruments(song, {
    fm1: st.bassFm,
    fm2: st.chordFm,
    fm3: FM.PLUCK,
    fm4: st.leadFm,
    fm5: st.padFm,
    sq1: PSG.LEAD,
    sq2: st.arpPsg,
    sq3: PSG.ECHO,
  })
  const progDef = rng.pick(st.progs)
  const prog: BarChord[] = progDef.chords.map(([deg, type]) => chordForDegree(st.scale, deg, type))
  const bassRhythm = rng.pick(st.bassRhythms)
  const bassAlt = rng.pick(st.bassRhythms)
  const arpShape = rng.pick(['up', 'updown', 'skip'] as const)

  const sections: { name: string; layers: string[]; repeat: number }[] = [
    { name: 'INTRO', layers: ['chords', 'arp', 'hat'], repeat: 1 },
    { name: 'A', layers: ['drums', 'bass', 'chords', 'arp', 'lead'], repeat: 2 },
    { name: 'B', layers: ['drums', 'bass', 'chords', 'arp', 'lead2', 'fill'], repeat: 2 },
    { name: 'BRK', layers: ['chords', 'arp', 'bassSoft', 'drumsSoft'], repeat: 1 },
    { name: 'FINAL', layers: ['drums', 'bass', 'chords', 'arp', 'lead', 'lead2', 'fill'], repeat: 2 },
    { name: 'OUTRO', layers: ['chords', 'bassSoft', 'drumsSoft'], repeat: 1 },
  ]
  for (const sec of sections) {
    const pat = emptyPattern(song, bars, sec.name)
    const rec: NoteRec = {}
    ctx.prog = prog
    for (const layer of sec.layers) {
      switch (layer) {
        case 'drums':
          genericDrums(ctx, rec, st.drumSet, bars, 'full', false)
          break
        case 'drumsSoft':
          genericDrums(ctx, rec, st.drumSet, bars, 'soft', false)
          break
        case 'fill':
          break
        case 'hat':
          for (let b = 4; b < bars; b++) for (let s = 0; s < spb; s += 2) put(rec, 'ch6', barStart(ctx, b) + s, 1, DR.HAT, 6)
          break
        case 'bass':
          genericBass(ctx, rec, st, sec.name === 'FINAL' ? bassAlt : bassRhythm, 'fm1', 36, bars)
          break
        case 'bassSoft':
          genericBass(ctx, rec, st, [{ s: 0, l: spb, p: 0 }], 'fm1', 36, bars)
          break
        case 'chords':
          genericChords(ctx, rec, st, bars)
          break
        case 'arp':
          genericArp(ctx, rec, bars, 'sq2', st.drumSet === 'boss' ? 1 : 2, arpShape)
          break
        case 'lead':
          genericLead(ctx, rec, st, bars, 'fm4')
          break
        case 'lead2':
          genericLead(ctx, rec, st, bars, 'sq1', 4)
          break
        default:
          break
      }
    }
    applyNotes(song, pat, rec)
    song.patterns.push(pat)
    for (let r = 0; r < sec.repeat; r++) song.order.push(pat.id)
  }
  song.loopStart = 1
  return song
}

// ═════════════════════════════════════════════════════════════════════════════
//  Tema en blanco
// ═════════════════════════════════════════════════════════════════════════════
/** de dónde salen las pistas, los instrumentos y el kit de un tema nuevo */
export type PaletteId = StyleId | 'basic'

export interface BlankOptions {
  title?: string
  bpm: number
  beatsPerBar: number
  /** tónica 0-11 (0 = Do) */
  key: number
  scale: ScaleId
  /** compases del primer patrón */
  bars: number
  /** 'basic' = banco de fábrica tal cual; un estilo = su reparto de pistas, sus sonidos y su kit */
  palette: PaletteId
}

/** Tema para empezar de cero: un único patrón vacío, con los sonidos de la paleta elegida ya repartidos por las pistas. */
export function createBlankSong(o: BlankOptions): Song {
  const key = Math.max(0, Math.min(11, Math.round(o.key)))
  const song = o.palette === 'basic' ? createEmptySong() : generateSong({ style: o.palette, seed: 1, key, bars: 4 })
  song.title = o.title?.trim().slice(0, 40) || 'SIN TÍTULO'
  song.bpm = Math.max(30, Math.min(300, Math.round(o.bpm)))
  song.beatsPerBar = Math.max(2, Math.min(7, Math.round(o.beatsPerBar)))
  song.swing = 0
  song.swingGrid = 2
  song.key = key
  song.scale = o.scale
  song.patterns = []
  const pat = emptyPattern(song, Math.max(1, Math.min(MAX_BARS, Math.round(o.bars))), 'A')
  song.patterns = [pat]
  song.order = [pat.id]
  song.loopStart = 0
  return song
}

// ═════════════════════════════════════════════════════════════════════════════
//  Regeneración de una pista dentro de un patrón (botón "dado")
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Devuelve notas nuevas para `trackId` del patrón. La armonía se toma de la
 * escala/tónica de la canción con una progresión elegida por la semilla.
 */
export function generateTrackNotes(song: Song, pat: Pattern, trackId: string, kind: FillKind, seed: number, style: StyleId = 'adventure'): Note[] {
  const notes = isElectro(style)
    ? electroTrackNotes(song, pat, trackId, kind, new Rng(seed), style)
    : isJazz(style)
      ? jazzTrackNotes(song, pat, trackId, kind, new Rng(seed), style)
      : genericTrackNotes(song, pat, trackId, kind, seed, style)
  const tr = song.tracks.find((t) => t.id === trackId)
  if (tr?.kind === 'psg') tunePsg(notes, tr.transpose)
  // en el PSG, lo que no nace calibrado sube lo mismo que al generar el tema entero: la parte de
  // la recalibración que no cupo en el volumen de la pista
  if ((tr?.kind === 'psg' || tr?.kind === 'noise') && !nativePsg(style)) {
    const { rest } = psgRecal(referenceVol(style, trackId))
    if (rest >= 1.03) for (const n of notes) n.vel = Math.max(1, Math.min(15, Math.round(n.vel * rest)))
  }
  return notes
}

const refVols = new Map<StyleId, Record<string, number>>()
/** volumen con el que el estilo escribe esa pista en la referencia antigua (antes de psgToHardware) */
function referenceVol(style: StyleId, trackId: string): number {
  let vols = refVols.get(style)
  if (!vols) {
    vols = Object.fromEntries(composeSong({ style, seed: 1, key: 0, bars: 4 }).tracks.map((t) => [t.id, t.vol]))
    refVols.set(style, vols)
  }
  return vols[trackId] ?? 100
}

function genericTrackNotes(song: Song, pat: Pattern, trackId: string, kind: FillKind, seed: number, style: Exclude<StyleId, ElectroStyle | JazzStyle>): Note[] {
  const rng = new Rng(seed)
  const spb = song.beatsPerBar * 4
  const bars = pat.bars
  const scale = song.scale
  const st = GENERIC[style === 'era' ? 'adventure' : style]
  const steps = scaleById(scale).steps
  const isMinorish = steps.includes(3)
  const progs: ProgDef[] = isMinorish
    ? [
        { chords: [[0, 'min'], [5, 'maj'], [6, 'maj'], [0, 'min']] },
        { chords: [[0, 'min'], [3, 'min'], [5, 'maj'], [6, 'maj']] },
        { chords: [[0, 'min'], [6, 'maj'], [5, 'maj'], [4, 'min']] },
      ]
    : st.progs
  const def = rng.pick(progs)
  const prog: BarChord[] = def.chords.map(([d, t]) => chordForDegree(isMinorish ? 'minor' : scale, d, t))
  const ctx: Ctx = { rng, song, key: song.key, scale, spb, tr: keyShift(song.key), prog }
  const rec: NoteRec = {}
  const tr = song.tracks.find((t) => t.id === trackId)
  const rhythm = rng.pick(st.bassRhythms)
  switch (kind) {
    case 'bass':
      genericBass(ctx, rec, st, rhythm, trackId, 36, bars)
      break
    case 'chords':
      genericChords(ctx, rec, st, bars)
      // genericChords escribe en fm2/fm5: redirige a la pista pedida
      if (trackId !== 'fm2' && rec.fm2) rec[trackId] = rec.fm2
      break
    case 'arp':
      genericArp(ctx, rec, bars, trackId, rng.pick([1, 2] as const), rng.pick(['up', 'updown', 'skip'] as const))
      break
    case 'lead':
      genericLead(ctx, rec, st, bars, trackId, 4)
      break
    case 'drums':
      genericDrums(ctx, rec, rng.pick(['adventure', 'boss', 'house'] as const), bars, 'full', true)
      break
    case 'perc':
      for (let b = 0; b < bars; b++) {
        const at = barStart(ctx, b)
        for (let s = 0; s < spb; s += 2) put(rec, trackId, at + s, 1, tr?.kind === 'noise' ? NZ.HAT : DR.HAT, s % 4 === 0 ? 8 : 11)
        if (b % 2 === 1) put(rec, trackId, at + spb - 2, 1, tr?.kind === 'noise' ? NZ.OPEN : DR.OPEN, 9)
      }
      break
  }
  const out = rec[trackId] ?? []
  const max = patternSteps(song, pat)
  return out
    .filter((n) => n.step < max)
    .map((n) => ({ ...n, len: Math.min(n.len, max - n.step) }))
    .sort((a, b) => a.step - b.step || a.note - b.note)
}
