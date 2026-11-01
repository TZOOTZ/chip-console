// ── Modelo de canción ───────────────────────────────────────────────────────
//
// La canción es JSON puro e inmutable (la UI la edita con immer). El mismo
// objeto lo leen el motor de audio (AudioWorklet), los exportadores y el
// generador, así que no contiene nada del navegador.
import { clamp, type ScaleId } from './theory'

/**
 * v2: el PSG está calibrado contra la consola (7,5 dB por debajo de la v1) y las notas pueden
 * llevar ligadura y panorama propio. Las canciones v1 se adaptan al cargarlas (ver psgToHardware).
 */
export const SONG_VERSION = 2
/** lo que bajó el nivel del PSG al calibrarlo contra la consola (dB) */
export const PSG_RECAL_DB = 7.5
export const MAX_BARS = 32
export const MAX_PATTERNS = 36
export const MAX_ORDER = 128

// ── instrumentos ────────────────────────────────────────────────────────────
export interface Vibrato {
  /** frames (60 Hz) antes de empezar */
  delay: number
  /** Hz */
  rate: number
  /** cents de desviación máxima */
  depth: number
}

export interface PitchEnv {
  /** semitonos por encima de la nota al inicio */
  semis: number
  /** frames que tarda en llegar a la nota (decaimiento exponencial) */
  frames: number
}

export interface FmOp {
  mul: number // 0-15 (0 = ×0.5)
  dt: number // 0-7 (0-3 = +0..+3, 4-7 = -0..-3)
  tl: number // 0-127 (0 = más fuerte, 0.75 dB por paso)
  rs: number // 0-3 key scale
  ar: number // 0-31
  d1r: number // 0-31
  sl: number // 0-15
  d2r: number // 0-31
  rr: number // 0-15
  am: number // 0|1 sensible al LFO de amplitud
}

export interface FmPatch {
  name: string
  alg: number // 0-7
  fb: number // 0-7
  /** operadores en orden lógico OP1..OP4 (el que tiene realimentación es el 1) */
  ops: FmOp[]
  /** sensibilidad al LFO hardware: amplitud (0-3) y vibrato (0-7) */
  ams: number
  pms: number
  vib?: Vibrato
  pitchEnv?: PitchEnv
  /**
   * Cuánto se cierra el timbre al tocar suave: dB que se atenúan los moduladores a velocidad
   * mínima (0 = la velocidad solo cambia el volumen, como en los drivers clásicos).
   */
  velMod?: number
}

export interface PsgInst {
  name: string
  /** nivel de pico 1-15 (15 = máximo) */
  vol: number
  /** frames de ataque / decaimiento / liberación */
  a: number
  d: number
  /** pasos de atenuación (2 dB) que baja el sustain respecto al pico */
  s: number
  r: number
  vib?: Vibrato
  pitchEnv?: PitchEnv
  /** desafinación fija en cents */
  detune: number
}

export interface NoiseVoice {
  name: string
  white: boolean
  /** 0-2 = tasa fija (alta → baja) · 3 = sigue al tono del canal SQ3 */
  rate: number
  vol: number
  a: number
  d: number
  s: number
  r: number
}

/**
 * `zap` = syndrum / láser: seno con barrido de tono descendente ·
 * `timp` = timbal de orquesta afinable (pitch 0-1 = Do2-Do4) · `crash` = plato ·
 * `sample` = una muestra real (PCM de 8 bits en `pcm`), que no se sintetiza
 */
export type DrumKind = 'kick' | 'snare' | 'hat' | 'ohat' | 'clap' | 'tom' | 'rim' | 'cow' | 'zap' | 'timp' | 'crash' | 'sample'

export interface DrumVoice {
  name: string
  kind: DrumKind
  /** 0-1 afinación */
  pitch: number
  /** 0-1 duración */
  decay: number
  /** 0-1 mezcla tono/ruido o brillo */
  tone: number
  /** 0-1 nivel */
  gain: number
  /** `sample`: PCM de 8 bits sin signo (0x80 = silencio) en base64 */
  pcm?: string
  /** `sample`: frecuencia a la que está grabada la muestra (Hz) */
  rate?: number
}

/** lo más que cabe una muestra en una canción: 24 KB de PCM (el cartucho será bastante más estricto) */
export const MAX_SAMPLE_B64 = 32768

/** valor de `pitch` que afina un timbal (`timp`) a una nota MIDI: 36 = Do2 → 0 … 60 = Do4 → 1 */
export const timpPitch = (midi: number): number => clamp(Math.round(((midi - 36) / 24) * 1e4) / 1e4, 0, 1)

// ── pistas, notas, patrones ─────────────────────────────────────────────────
export type TrackKind = 'fm' | 'psg' | 'noise' | 'dac'

export interface Track {
  id: string
  name: string
  kind: TrackKind
  /** canal físico dentro de su chip: FM 0-5 · PSG 0-2 · ruido 3 */
  ch: number
  /** índice en el banco de su tipo (fmBank / psgBank) */
  inst: number
  /** 0-100 */
  vol: number
  pan: 'C' | 'L' | 'R'
  mute: boolean
  solo: boolean
  /** proporción de la duración que suena la nota antes del release (0.2-1) */
  gate: number
  /** transposición en semitonos aplicada al reproducir */
  transpose: number
  /** frames (60 Hz) que tarda en llegar a su altura una nota ligada: 0 = ligadura seca, más = portamento */
  glide: number
}

export type Pan = 'C' | 'L' | 'R'

export interface Note {
  /** paso de inicio dentro del patrón */
  step: number
  /** duración en pasos (≥ 1) */
  len: number
  /** nota MIDI (en pistas de batería: índice del sonido) */
  note: number
  /** velocidad 1-15 */
  vel: number
  /** ligada a la nota anterior de la pista: no se re-ataca y la altura se desliza hasta ella */
  slide?: boolean
  /** panorama propio de la nota (FM y batería PCM); si falta, vale el de la pista */
  pan?: Pan
}

export interface Pattern {
  id: string
  name: string
  bars: number
  notes: Record<string, Note[]>
}

export interface Song {
  version: number
  title: string
  author: string
  bpm: number
  /** 0-0.5 · retrasa la segunda mitad de cada celda de swing */
  swing: number
  /** pasos de una celda de swing: 2 = pareja de semicorcheas (por defecto) · 4 = pareja de corcheas (jazz) */
  swingGrid: number
  beatsPerBar: number
  /** tónica (0 = C) y escala: guía visual y base del generador */
  key: number
  scale: ScaleId
  /** frecuencia de reproducción de los samples del DAC (Hz) */
  dacRate: number
  /** LFO hardware del YM2612: 0 = apagado · 1-8 = 3.9, 5.6, 6.0, 6.4, 6.9, 9.6, 48, 72 Hz */
  lfo: number
  fmBank: FmPatch[]
  psgBank: PsgInst[]
  noiseKit: NoiseVoice[]
  drumKit: DrumVoice[]
  tracks: Track[]
  patterns: Pattern[]
  /** ids de patrón en orden de reproducción */
  order: string[]
  /** índice del orden al que vuelve al terminar (-1 = parar) */
  loopStart: number
}

export const stepsPerBar = (song: Pick<Song, 'beatsPerBar'>): number => song.beatsPerBar * 4

export const patternSteps = (song: Pick<Song, 'beatsPerBar'>, p: Pattern): number => p.bars * stepsPerBar(song)

export function getPattern(song: Song, id: string): Pattern | undefined {
  return song.patterns.find((p) => p.id === id)
}

export function trackIndex(song: Song, id: string): number {
  return song.tracks.findIndex((t) => t.id === id)
}

/** pasos totales de la canción siguiendo el orden */
export function songSteps(song: Song): number {
  let n = 0
  for (const id of song.order) {
    const p = getPattern(song, id)
    if (p) n += patternSteps(song, p)
  }
  return n
}

/** segundos que dura una pasada completa del orden */
export function songSeconds(song: Song): number {
  return (songSteps(song) * 60) / (song.bpm * 4)
}

export function nextPatternId(song: Pick<Song, 'patterns'>): string {
  let i = song.patterns.length + 1
  const ids = new Set(song.patterns.map((p) => p.id))
  while (ids.has(`p${i}`)) i++
  return `p${i}`
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export function nextPatternName(song: Pick<Song, 'patterns'>): string {
  const names = new Set(song.patterns.map((p) => p.name))
  for (const ch of LETTERS) if (!names.has(ch)) return ch
  return `P${song.patterns.length + 1}`
}

export function emptyPattern(song: Pick<Song, 'patterns' | 'tracks'>, bars = 4, name?: string): Pattern {
  const notes: Record<string, Note[]> = {}
  for (const t of song.tracks) notes[t.id] = []
  return { id: nextPatternId(song), name: name ?? nextPatternName(song), bars, notes }
}

export function defaultTracks(): Track[] {
  const mk = (id: string, name: string, kind: TrackKind, ch: number, inst: number, pan: Track['pan'] = 'C'): Track => ({
    id,
    name,
    kind,
    ch,
    inst,
    vol: 100,
    pan,
    mute: false,
    solo: false,
    gate: 0.92,
    transpose: 0,
    glide: 0,
  })
  return [
    mk('fm1', 'BASS', 'fm', 0, 0),
    mk('fm2', 'KEYS', 'fm', 1, 4, 'L'),
    mk('fm3', 'CHORD', 'fm', 2, 4, 'R'),
    mk('fm4', 'LEAD', 'fm', 3, 8),
    mk('fm5', 'PAD', 'fm', 4, 12, 'L'),
    mk('ch6', 'DRUMS', 'dac', 5, 0),
    mk('sq1', 'SQ 1', 'psg', 0, 0),
    mk('sq2', 'SQ 2', 'psg', 1, 1),
    mk('sq3', 'SQ 3', 'psg', 2, 2),
    mk('noise', 'NOISE', 'noise', 3, 0),
  ]
}

// ── saneamiento (importaciones, enlaces compartidos) ────────────────────────
const num = (v: unknown, def: number, lo: number, hi: number, int = false): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def
  return clamp(int ? Math.round(n) : n, lo, hi)
}
const str = (v: unknown, def: string, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : def)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function cleanVib(v: unknown): Vibrato | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = rec(v)
  return { delay: num(o.delay, 0, 0, 120, true), rate: num(o.rate, 5, 0.5, 14), depth: num(o.depth, 20, 0, 400) }
}
function cleanPitchEnv(v: unknown): PitchEnv | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = rec(v)
  return { semis: num(o.semis, 12, -48, 48), frames: num(o.frames, 6, 1, 60, true) }
}

export function cleanFmOp(raw: unknown, def: FmOp): FmOp {
  const o = rec(raw)
  return {
    mul: num(o.mul, def.mul, 0, 15, true),
    dt: num(o.dt, def.dt, 0, 7, true),
    tl: num(o.tl, def.tl, 0, 127, true),
    rs: num(o.rs, def.rs, 0, 3, true),
    ar: num(o.ar, def.ar, 0, 31, true),
    d1r: num(o.d1r, def.d1r, 0, 31, true),
    sl: num(o.sl, def.sl, 0, 15, true),
    d2r: num(o.d2r, def.d2r, 0, 31, true),
    rr: num(o.rr, def.rr, 0, 15, true),
    am: num(o.am, def.am, 0, 1, true),
  }
}

const SILENT_OP: FmOp = { mul: 1, dt: 0, tl: 127, rs: 0, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 15, am: 0 }

export function cleanFmPatch(raw: unknown): FmPatch {
  const o = rec(raw)
  const ops = Array.isArray(o.ops) ? o.ops : []
  return {
    name: str(o.name, 'FM'),
    alg: num(o.alg, 4, 0, 7, true),
    fb: num(o.fb, 0, 0, 7, true),
    ops: [0, 1, 2, 3].map((i) => cleanFmOp(ops[i], SILENT_OP)),
    ams: num(o.ams, 0, 0, 3, true),
    pms: num(o.pms, 0, 0, 7, true),
    vib: cleanVib(o.vib),
    pitchEnv: cleanPitchEnv(o.pitchEnv),
    ...(typeof o.velMod === 'number' && o.velMod > 0 ? { velMod: num(o.velMod, 0, 0, 36) } : {}),
  }
}

export function cleanPsgInst(raw: unknown): PsgInst {
  const o = rec(raw)
  return {
    name: str(o.name, 'PSG'),
    vol: num(o.vol, 13, 1, 15, true),
    a: num(o.a, 0, 0, 60, true),
    d: num(o.d, 0, 0, 120, true),
    s: num(o.s, 0, 0, 15, true),
    r: num(o.r, 3, 0, 120, true),
    vib: cleanVib(o.vib),
    pitchEnv: cleanPitchEnv(o.pitchEnv),
    detune: num(o.detune, 0, -100, 100),
  }
}

export function cleanNoiseVoice(raw: unknown): NoiseVoice {
  const o = rec(raw)
  return {
    name: str(o.name, 'NOISE'),
    white: o.white !== false,
    rate: num(o.rate, 0, 0, 3, true),
    vol: num(o.vol, 13, 1, 15, true),
    a: num(o.a, 0, 0, 60, true),
    d: num(o.d, 4, 0, 120, true),
    s: num(o.s, 15, 0, 15, true),
    r: num(o.r, 0, 0, 120, true),
  }
}

const DRUM_KINDS: DrumKind[] = ['kick', 'snare', 'hat', 'ohat', 'clap', 'tom', 'rim', 'cow', 'zap', 'timp', 'crash', 'sample']
export function cleanDrumVoice(raw: unknown): DrumVoice {
  const o = rec(raw)
  let kind = DRUM_KINDS.includes(o.kind as DrumKind) ? (o.kind as DrumKind) : 'kick'
  // una muestra sin PCM válido (o demasiado grande) vuelve a ser un sonido sintético
  const pcm = typeof o.pcm === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(o.pcm) && o.pcm.length <= MAX_SAMPLE_B64 ? o.pcm : undefined
  if (kind === 'sample' && !pcm) kind = 'cow'
  const v: DrumVoice = {
    name: str(o.name, kind.toUpperCase(), 12),
    kind,
    pitch: num(o.pitch, 0.5, 0, 1),
    decay: num(o.decay, 0.5, 0, 1),
    tone: num(o.tone, 0.5, 0, 1),
    gain: num(o.gain, 0.9, 0, 1),
  }
  if (kind === 'sample' && pcm) {
    v.pcm = pcm
    v.rate = num(o.rate, 11025, 2000, 48000, true)
  }
  return v
}

function cleanNotes(raw: unknown, maxSteps: number, maxNote: number): Note[] {
  if (!Array.isArray(raw)) return []
  const out: Note[] = []
  for (const r of raw) {
    const o = rec(r)
    const step = num(o.step, -1, -1, maxSteps - 1, true)
    if (step < 0) continue
    const n: Note = {
      step,
      len: num(o.len, 1, 1, maxSteps - step, true),
      note: num(o.note, 60, 0, maxNote, true),
      vel: num(o.vel, 12, 1, 15, true),
    }
    if (o.slide === true) n.slide = true
    if (o.pan === 'L' || o.pan === 'R' || o.pan === 'C') n.pan = o.pan
    out.push(n)
  }
  out.sort((a, b) => a.step - b.step || a.note - b.note)
  return out.slice(0, 2048)
}

/**
 * Normaliza cualquier objeto a una canción válida. Rellena lo que falta con
 * valores por defecto (`base`), recorta rangos y descarta notas inválidas.
 */
export function sanitizeSong(raw: unknown, base: Song): Song {
  const o = rec(raw)
  const song: Song = {
    version: SONG_VERSION,
    title: str(o.title, base.title, 60),
    author: str(o.author, base.author, 60),
    bpm: num(o.bpm, base.bpm, 30, 300, true),
    swing: num(o.swing, base.swing, 0, 0.5),
    swingGrid: o.swingGrid === 4 ? 4 : o.swingGrid === 2 ? 2 : base.swingGrid,
    beatsPerBar: num(o.beatsPerBar, base.beatsPerBar, 2, 8, true),
    key: num(o.key, base.key, 0, 11, true),
    scale: (typeof o.scale === 'string' ? o.scale : base.scale) as ScaleId,
    dacRate: [11025, 14700, 22050].includes(o.dacRate as number) ? (o.dacRate as number) : base.dacRate,
    lfo: num(o.lfo, base.lfo, 0, 8, true),
    fmBank: Array.isArray(o.fmBank) && o.fmBank.length ? o.fmBank.slice(0, 64).map(cleanFmPatch) : base.fmBank,
    psgBank: Array.isArray(o.psgBank) && o.psgBank.length ? o.psgBank.slice(0, 32).map(cleanPsgInst) : base.psgBank,
    noiseKit: Array.isArray(o.noiseKit) && o.noiseKit.length ? o.noiseKit.slice(0, 8).map(cleanNoiseVoice) : base.noiseKit,
    drumKit: Array.isArray(o.drumKit) && o.drumKit.length ? o.drumKit.slice(0, 8).map(cleanDrumVoice) : base.drumKit,
    tracks: [],
    patterns: [],
    order: [],
    loopStart: 0,
  }

  const baseTracks = defaultTracks()
  const rawTracks = Array.isArray(o.tracks) ? o.tracks : []
  song.tracks = baseTracks.map((bt) => {
    const t = rec(rawTracks.find((x) => rec(x).id === bt.id))
    const kind = bt.id === 'ch6' && t.kind === 'fm' ? 'fm' : bt.kind
    const instMax = kind === 'fm' ? song.fmBank.length - 1 : kind === 'psg' ? song.psgBank.length - 1 : 0
    return {
      id: bt.id,
      name: str(t.name, bt.name, 12),
      kind,
      ch: bt.ch,
      inst: num(t.inst, bt.inst, 0, Math.max(0, instMax), true),
      vol: num(t.vol, bt.vol, 0, 100, true),
      pan: t.pan === 'L' || t.pan === 'R' || t.pan === 'C' ? t.pan : bt.pan,
      mute: t.mute === true,
      solo: t.solo === true,
      gate: num(t.gate, bt.gate, 0.1, 1),
      transpose: num(t.transpose, 0, -36, 36, true),
      glide: num(t.glide, 0, 0, 60, true),
    }
  })

  const rawPats = Array.isArray(o.patterns) ? o.patterns.slice(0, MAX_PATTERNS) : []
  const seen = new Set<string>()
  for (const rp of rawPats) {
    const p = rec(rp)
    let id = str(p.id, '', 12)
    if (!id || seen.has(id)) id = nextPatternId({ patterns: song.patterns })
    seen.add(id)
    const bars = num(p.bars, 4, 1, MAX_BARS, true)
    const maxSteps = bars * song.beatsPerBar * 4
    const rawNotes = rec(p.notes)
    const notes: Record<string, Note[]> = {}
    for (const t of song.tracks) {
      const maxNote = t.kind === 'dac' || t.kind === 'noise' ? 15 : 127
      notes[t.id] = cleanNotes(rawNotes[t.id], maxSteps, maxNote)
    }
    song.patterns.push({ id, name: str(p.name, nextPatternName({ patterns: song.patterns }), 8), bars, notes })
  }
  if (song.patterns.length === 0) song.patterns.push(emptyPattern(song, 4))

  const ids = new Set(song.patterns.map((p) => p.id))
  const rawOrder = Array.isArray(o.order) ? o.order : []
  song.order = rawOrder.filter((x): x is string => typeof x === 'string' && ids.has(x)).slice(0, MAX_ORDER)
  if (song.order.length === 0) song.order = [song.patterns[0].id]
  song.loopStart = num(o.loopStart, 0, -1, song.order.length - 1, true)
  // las canciones anteriores a la v2 se mezclaron con el PSG 7,5 dB más alto de lo que da la consola
  if (!(typeof o.version === 'number' && o.version >= 2)) psgToHardware(song)
  return song
}

/**
 * Lleva las pistas de PSG y ruido de una canción escrita con la referencia antigua a la
 * calibración de hardware: sube lo que el chip permite (primero el volumen de la pista, después
 * la velocidad de las notas) para conservar el balance con el FM. Lo que ya estaba cerca del
 * máximo se queda en el máximo: el PSG real no da más.
 */
export function psgToHardware(song: Song): void {
  for (const t of song.tracks) {
    if (t.kind !== 'psg' && t.kind !== 'noise') continue
    if (t.vol <= 0) continue
    const { vol, rest } = psgRecal(t.vol)
    t.vol = vol
    if (rest < 1.03) continue
    for (const p of song.patterns) for (const n of p.notes[t.id] ?? []) n.vel = clamp(Math.round(n.vel * rest), 1, 15)
  }
}

/** reparto de la recalibración para una pista que estaba a `old`: su volumen nuevo y el factor que queda para las velocidades */
export function psgRecal(old: number): { vol: number; rest: number } {
  const gain = Math.pow(10, PSG_RECAL_DB / 20)
  const vol = Math.min(100, Math.round(old * gain))
  return { vol, rest: vol > 0 ? (gain * old) / vol : 1 }
}
