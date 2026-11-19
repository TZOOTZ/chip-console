// ── TORMENTA: cuerdas en menor bajo la tormenta, y el pararrayos ────────────
//
// Lo serio de COSMIC DISCO (sus progresiones con cadencia y su tema por ideas, cosmic.ts) tocado por
// una orquesta de cuerda de Mega Drive: violín solista, ostinato en spiccato, una segunda sección que
// cambia con la semilla (sostenida, en pizzicato o sul ponticello), chelos y timbales. Por encima, la
// tormenta: lluvia en el canal de ruido y el pararrayos, que zumba y se carga (FM con portamento hacia
// arriba, chispazos cada vez más seguidos en el DAC, chispas en el PSG) hasta que cae el rayo. El
// trueno llega después del rayo, y más tarde y más flojo cuanto más lejos cae.
import { CH, COSMIC_PROGS, augment, buildTheme, emit, pickSpec, second, type Deg } from './cosmic'
import { electroTrackNotes } from './electro'
import {
  X,
  addSection,
  bassRoot,
  chordPcs,
  chordSeries,
  dv,
  hit,
  makeEnv,
  mod12,
  padVoices,
  roll,
  setScale,
  setupTracks,
  writeBass,
  writeEcho,
  type BassPat,
  type Env,
  type Harm,
} from './electrokit'
import { FM, PSG, Rng, put, type FillKind, type NoteRec } from './genkit'
import { patternSteps, timpPitch, type Note, type Pattern, type Song } from './song'

export const STORM_BPM: [number, number] = [132, 148]

// ── el kit: la orquesta y la tormenta ───────────────────────────────────────
const GRAN = 0
const CAJA = 1
const ARC = 2
const TRUENO = 3
const RAYO = 4
const TIMP_V = 5
const TIMP_I = 6
const PLATO = 7

/** golpe en el DAC; si ya hay uno igual en ese paso se queda el más fuerte: dos iguales gastarían dos de las cuatro voces */
function beat(rec: NoteRec, at: number, drum: number, vel: number): void {
  const same = rec.ch6?.find((n) => n.step === at && n.note === drum)
  if (same) same.vel = Math.max(same.vel, Math.min(15, vel))
  else hit(rec, at, drum, vel)
}

// el ruido: los seis de fábrica y, detrás, la lluvia (siseo sostenido y flojo que se funde al soltar) y el
// trueno (ruido grave que tarda en apagarse). Un kit tiene ocho sonidos como mucho: por eso no van en el de fábrica
const NZ_LLUVIA = 6
const NZ_TRUENO = 7

/** timbales afinados como en COSMIC: el agudo en la tónica y el grave una cuarta por debajo */
function stormKit(env: Env): void {
  env.song.noiseKit = [
    ...env.song.noiseKit.slice(0, 6),
    { name: 'LLUVIA', white: true, rate: 0, vol: 8, a: 0, d: 0, s: 0, r: 12 },
    { name: 'TRUENO', white: true, rate: 2, vol: 15, a: 0, d: 50, s: 15, r: 30 },
  ]
  const tonic = 45 + mod12(env.key - 9)
  env.song.drumKit = [
    dv('GRAN CASSA', 'kick', 0.3, 0.8, 0.3, 0.95),
    dv('CAJA', 'snare', 0.55, 0.35, 0.7, 0.8),
    dv('CHISPAZO', 'arc', 0.3, 0.5, 0.5, 0.8),
    dv('TRUENO', 'thunder', 0.4, 0.75, 0.45, 0.95),
    dv('RAYO', 'bolt', 0.5, 0.55, 0.65, 0.9),
    dv('TIMPANI V', 'timp', timpPitch(tonic - 5), 0.8, 0.6, 0.8),
    dv('TIMPANI I', 'timp', timpPitch(tonic), 0.75, 0.6, 0.8),
    dv('PLATO', 'crash', 0.5, 0.7, 0.45, 0.6),
  ]
}

// ── chelos ──────────────────────────────────────────────────────────────────
const onBeats = (long: number): number[] => Array.from({ length: 16 }, (_, s) => (s % 4 === 0 ? long : 1))

/** dibujos de los chelos: compás normal (m) y cierre de frase que lleva al acorde siguiente (e) */
interface CelloStyle {
  m: BassPat
  e: BassPat
}
const CELLOS: CelloStyle[] = [
  {
    // galope: larga-corta-corta, el pulso de la cabalgata
    m: { len: 1, lens: onBeats(2), steps: [0, X, 0, 0, 0, X, 0, 0, 0, X, 0, 0, 0, X, 12, 12] },
    e: { len: 1, lens: onBeats(2), steps: [0, X, 0, 0, 0, X, 0, 0, 12, X, 7, 7, 12, 7, 96, 99] },
  },
  {
    // motor: semicorcheas que saltan a la quinta y a la octava
    m: { len: 1, steps: [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 0, 7, 0] },
    e: { len: 1, steps: [0, 0, 7, 0, 12, 0, 7, 0, 0, 7, 12, 7, 12, 7, 96, 99] },
  },
  {
    // pesado: corcheas en la fundamental, como una marcha
    m: { len: 2, steps: [0, X, 0, X, 0, X, 0, X, 0, X, 0, X, 0, X, 0, X] },
    e: { len: 2, steps: [0, X, 0, X, 0, X, 0, X, 7, X, 7, X, 12, X, 99, X] },
  },
]

function writeCellos(env: Env, rec: NoteRec, prog: Harm[], bars: number, st: CelloStyle, o: { vel?: number; from?: number; to?: number } = {}): void {
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const end = b % 4 === 3 || b === bars - 1
    writeBass(env, rec, 'fm1', prog, bars, end ? st.e : st.m, { vel: o.vel, from: b, to: b + 1 })
  }
}

/** pedal de chelos: la fundamental en redondas, para la calma */
function cellosLong(env: Env, rec: NoteRec, prog: Harm[], bars: number, vel: number): void {
  for (let b = 0; b < bars; b++) put(rec, 'fm1', b * env.spb, env.spb, bassRoot(env, prog[b % prog.length]), vel)
}

// ── violines: ostinato en spiccato ──────────────────────────────────────────
/** figuras de un compás sobre las notas del acorde (0 = la más grave de la serie) */
const FIGURES: number[][] = [
  [0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3], // trémolo medido por pares
  [2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 3, 0, 2, 0], // bariolaje sobre la nota grave
  [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1], // olas
  [0, 2, 1, 2, 0, 2, 1, 2, 0, 3, 1, 3, 0, 3, 2, 3], // cuerdas cruzadas
]
/** el cierre de frase sube por el acorde hacia el siguiente */
const RUN = [0, 1, 2, 3, 4, 5, 4, 3]

function writeSpiccato(env: Env, rec: NoteRec, prog: Harm[], bars: number, fig: number[], o: { vel: number; from?: number; to?: number }): void {
  for (let b = o.from ?? 0; b < (o.to ?? bars); b++) {
    const ser = chordSeries(env, prog[b % prog.length], env.midTonic)
    if (ser.length === 0) continue
    const end = b % 4 === 3 || b === bars - 1
    for (let s = 0; s < Math.min(16, env.spb); s++) {
      const idx = end && s >= 8 ? RUN[s - 8] : fig[s]
      const acc = s % 4 === 0 ? 2 : s % 2 === 0 ? 0 : -1
      put(rec, 'fm2', b * env.spb + s, 1, ser[idx % ser.length], o.vel + acc)
    }
  }
}

// ── la segunda sección: sostenida, en pizzicato o sul ponticello ────────────
type Second = 'section' | 'pizz' | 'ponti'
const SECOND_INST: Record<Second, number> = { section: FM.VIOLINS, pizz: FM.PIZZICATO, ponti: FM.PONTICELLO }
const SECOND_NAME: Record<Second, string> = { section: 'VIOLINES II', pizz: 'PIZZICATO', ponti: 'PONTICELLO' }

function writeSecond(env: Env, rec: NoteRec, prog: Harm[], bars: number, kind: Second, vel: number, track = 'fm3'): void {
  let prev: number[] | null = null
  for (let b = 0; b < bars; b++) {
    const c = prog[b % prog.length]
    const at = b * env.spb
    if (kind === 'pizz') {
      // corcheas a contratiempo, como guitarra de la orquesta
      const ser = chordSeries(env, c, env.midTonic - 5)
      if (ser.length === 0) continue
      ;[2, 6, 10, 14].forEach((s, k) => s < env.spb && put(rec, track, at + s, 2, ser[[0, 1, 2, 1][k] % ser.length], vel + (k === 0 ? 1 : 0)))
      continue
    }
    // una voz por canal: la voz de en medio del acorde (sección) o la de arriba, aguda y vidriosa (ponticello)
    const v: number[] = kind === 'section' ? padVoices(env, prev, c, 55, 71) : padVoices(env, prev, c, 70, 86)
    prev = v
    const note = kind === 'section' ? v[1] : v[2]
    const last = rec[track]?.[rec[track].length - 1]
    if (last && last.note === note && last.step + last.len === at) last.len += env.spb
    else put(rec, track, at, env.spb, note, vel)
  }
}

// ── la tormenta ─────────────────────────────────────────────────────────────
/** nota del zumbido del pararrayos: la tónica en la octava 3 */
const humRoot = (env: Env): number => env.bassTonic + 12

/** el pararrayos en reposo: un zumbido grave sostenido */
function hum(env: Env, rec: NoteRec, from: number, to: number, vel: number): void {
  for (let b = from; b < to; b++) put(rec, 'fm5', b * env.spb, env.spb, humRoot(env), vel)
}

/**
 * La carga: el zumbido sube ligado (sin re-ataque, con el portamento de la pista) más de una octava,
 * los chispazos del DAC se apiñan y saltan chispas en el PSG, hasta el paso `to`, donde cae el rayo.
 */
function charge(env: Env, rec: NoteRec, from: number, to: number): void {
  const n = Math.max(1, Math.floor((to - from) / 2))
  for (let k = 0; k < n; k++) {
    const f = k / n
    put(rec, 'fm5', from + 2 * k, 2, humRoot(env) + k, Math.round(8 + 6 * f), k > 0 ? { slide: true } : undefined)
  }
  // chispazos: cada vez más seguidos (de 6 pasos a uno)
  for (let s = from, gap = 6; s < to; s += Math.max(1, Math.round(gap))) {
    const f = (s - from) / (to - from)
    beat(rec, s, ARC, Math.round(7 + 7 * f))
    gap *= 0.82
  }
  // chispas en la segunda mitad
  const r = env.rng
  for (let s = from + Math.floor((to - from) / 2); s < to; s += r.int(2, 3)) put(rec, 'sq1', s, 1, r.int(84, 100), r.int(12, 15))
}

/** golpe de chispas en el PSG */
function sparks(env: Env, rec: NoteRec, at: number, count: number, total: number): void {
  for (let k = 0, s = at; k < count && s < total; k++, s += env.rng.int(1, 2)) put(rec, 'sq1', s, 1, env.rng.int(86, 100), 15 - k)
}

/** el trueno: DAC y ruido a la vez; lejos, más flojo y sin estallido */
function thunder(rec: NoteRec, at: number, near: boolean, total: number, noise: [number, number][]): void {
  if (at >= total) return
  beat(rec, at, TRUENO, near ? 14 : 9)
  const len = Math.min(near ? 12 : 16, total - at)
  put(rec, 'noise', at, len, NZ_TRUENO, near ? 13 : 9)
  noise.push([at, len])
}

/** cae el rayo: chasquido, plato, timbal y gran cassa; las chispas saltan y el trueno llega tres pasos después */
function strike(env: Env, rec: NoteRec, at: number, total: number, noise: [number, number][]): void {
  beat(rec, at, RAYO, 15)
  beat(rec, at, PLATO, 12)
  beat(rec, at, TIMP_I, 14)
  beat(rec, at, GRAN, 15)
  sparks(env, rec, at, 4, total)
  thunder(rec, at + 3, true, total, noise)
}

/** la lluvia: siseo sostenido en los huecos que deja el trueno, con rachas que suben y bajan */
function rain(env: Env, rec: NoteRec, bars: number, vel: number, noise: [number, number][]): void {
  const total = bars * env.spb
  const busy = [...noise].sort((a, b) => a[0] - b[0])
  let s = 0
  for (const [at, len] of [...busy, [total, 0] as [number, number]]) {
    // un siseo por compás entre trueno y trueno (la racha cambia de compás a compás)
    while (s < at) {
      const end = Math.min(at, (Math.floor(s / env.spb) + 1) * env.spb)
      put(rec, 'noise', s, end - s, NZ_LLUVIA, vel + (Math.floor(s / env.spb) % 2 === 0 ? 0 : -1))
      s = end
    }
    s = Math.max(s, at + len)
  }
}

// ── percusión de la orquesta ────────────────────────────────────────────────
/** timbal que encaja con el acorde: el de la tónica o el de la dominante; null si ninguna */
function timp(c: Harm, prefer: 'tonic' | 'dominant'): number | null {
  const pcs = chordPcs(c)
  const hasI = pcs.includes(0)
  const hasV = pcs.includes(7)
  if (prefer === 'tonic') return hasI ? TIMP_I : hasV ? TIMP_V : null
  return hasV ? TIMP_V : hasI ? TIMP_I : null
}

/** redoble de timbal al cerrar cada frase de cuatro compases */
const TIMP_FILL: [number, number][] = [[8, 9], [10, 10], [12, 11], [13, 11], [14, 12], [15, 13]]

/** el pulso: gran cassa en 1 y 3, timbal en cada acorde nuevo, caja militar en los giros y redoble al cerrar frase */
function drive(env: Env, rec: NoteRec, prog: Harm[], bars: number, o: { from?: number; vel?: number; snare?: boolean } = {}): void {
  const v = o.vel ?? 14
  for (let b = o.from ?? 0; b < bars; b++) {
    const at = b * env.spb
    const c = prog[b % prog.length]
    beat(rec, at, GRAN, v)
    if (env.spb > 8) beat(rec, at + 8, GRAN, v - 3)
    const t = timp(c, 'tonic')
    if (t !== null && b > 0) beat(rec, at, t, v - 2)
    const end = b % 4 === 3 || b === bars - 1
    if (end) {
      const tf = timp(prog[(b + 1) % prog.length], 'dominant') ?? TIMP_V
      for (const [s, vel] of TIMP_FILL) if (s < env.spb) beat(rec, at + s, tf, vel)
    } else if (o.snare && b % 2 === 1) {
      // caja militar: tresillo de semicorcheas hacia el tiempo tres
      for (const [s, vel] of [[5, 7], [6, 8], [7, 10], [12, 9]] as [number, number][]) if (s < env.spb) beat(rec, at + s, CAJA, vel)
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  El tema completo
// ═════════════════════════════════════════════════════════════════════════════
/** velocidades del PSG, escritas ya para la calibración de la consola (pista a 100) */
const ECHO_VEL = 8
const VOICE2_VEL = 10

export function generateStorm(song: Song, rng: Rng, bars: number): void {
  const env = makeEnv(song, rng)
  const { spb } = env
  setScale(env, 'minor')
  const pd = rng.pick(COSMIC_PROGS)
  const prog: Deg[] = bars < 8 ? pd.short : pd.full
  const L = prog.length
  const spec = pickSpec(env)
  const theme = buildTheme(env, prog, bars, spec)
  const [cA, cB] = (() => {
    const a = rng.pick(CELLOS)
    return [a, rng.pick(CELLOS.filter((x) => x !== a))]
  })()
  const figA = rng.pick(FIGURES)
  const figB = rng.pick(FIGURES.filter((f) => f !== figA))
  const kind: Second = rng.pick(['section', 'pizz', 'ponti'] as const)
  const total = bars * spb
  const half = Math.floor(bars / 2)
  const last = bars - 1
  // el ponticello tiembla con el LFO del chip (9,6 Hz): el trémolo de arco
  if (kind === 'ponti') song.lfo = 6

  const slowChords = prog.slice(0, Math.max(1, half))
  if (slowChords.length > 1) slowChords[slowChords.length - 1] = CH.V7
  const slowProg = slowChords.flatMap((c) => [c, c])
  const slowTheme = augment(buildTheme(env, slowChords, slowChords.length, spec))
  const outProg = Array.from({ length: bars }, (_, b) => prog[b % L])
  outProg[last] = CH.i
  if (bars > 1) outProg[last - 1] = CH.V7

  stormKit(env)
  setupTracks(song, {
    fm1: { inst: FM.CELLO, name: 'CHELOS', vol: 90, pan: 'C', gate: 0.85 },
    fm2: { inst: FM.SPICCATO, name: 'VIOLINES I', vol: 74, pan: 'L', gate: 0.9 },
    fm3: { inst: SECOND_INST[kind], name: SECOND_NAME[kind], vol: kind === 'pizz' ? 80 : 64, pan: 'R', gate: 0.98 },
    fm4: { inst: FM.VIOLIN, name: 'VIOLIN', vol: 92, pan: 'C', glide: 3 },
    fm5: { inst: FM.PARARRAYOS, name: 'PARARRAYOS', vol: 56, pan: 'C', gate: 1, glide: 10 },
    ch6: { name: 'TORMENTA', vol: 100, pan: 'C' },
    sq1: { inst: PSG.CHISPA, name: 'CHISPAS', vol: 100 },
    sq2: { inst: PSG.LEAD, name: 'ECO', vol: 100 },
    sq3: { inst: PSG.LEAD, name: 'VOZ 2', vol: 100, glide: 3 },
    noise: { name: 'LLUVIA', vol: 100 },
  })

  addSection(song, 'INTRO', bars, 1, (rec) => {
    const noise: [number, number][] = []
    cellosLong(env, rec, [CH.i], bars, 10)
    writeSecond(env, rec, prog, bars, kind, 9)
    if (half < last) writeSpiccato(env, rec, prog, bars, figA, { vel: 9, from: half, to: last })
    // el pararrayos zumba y, en los dos últimos compases, se carga
    const chargeFrom = Math.max(0, bars - 2) * spb
    hum(env, rec, 0, Math.max(0, bars - 2), 7)
    charge(env, rec, chargeFrom, total)
    if (bars > 1) thunder(rec, spb + 8, false, total, noise)
    if (half + 1 < bars - 2) thunder(rec, (half + 1) * spb + 4, false, total, noise)
    roll(rec, last * spb + 8, total, CAJA, 5, 12)
    beat(rec, 0, TIMP_I, 9)
    rain(env, rec, bars, 12, noise)
  })

  addSection(song, 'A', bars, 1, (rec) => {
    const noise: [number, number][] = []
    strike(env, rec, 0, total, noise)
    drive(env, rec, prog, bars, {})
    writeCellos(env, rec, prog, bars, cA)
    writeSpiccato(env, rec, prog, bars, figA, { vel: 12 })
    writeSecond(env, rec, prog, bars, kind, 11)
    // el violín se asoma al final con la cabeza del tema, antes de exponerlo entero en B
    if (bars >= 4) emit(env, rec, 'fm4', theme.filter((n) => n.step >= (last - 1) * spb), { vel: 12 })
    if (half > 0) thunder(rec, half * spb + 6, false, total, noise)
    rain(env, rec, bars, 9, noise)
  })

  addSection(song, 'B', bars, 2, (rec) => {
    const noise: [number, number][] = []
    strike(env, rec, 0, total, noise)
    drive(env, rec, prog, bars, { snare: true })
    writeCellos(env, rec, prog, bars, cA)
    writeSpiccato(env, rec, prog, bars, figA, { vel: 11 })
    writeSecond(env, rec, prog, bars, kind, 11)
    emit(env, rec, 'fm4', theme)
    writeEcho(rec, 'fm4', 'sq2', 3, ECHO_VEL, total)
    if (half > 0) thunder(rec, half * spb + 2, false, total, noise)
    rain(env, rec, bars, 9, noise)
  })

  addSection(song, 'BRK', bars, 1, (rec) => {
    // el ojo de la tormenta: el tema a mitad de velocidad sobre la lluvia, y el pararrayos se vuelve a cargar
    const noise: [number, number][] = []
    beat(rec, 0, PLATO, 9)
    cellosLong(env, rec, slowProg, bars, 10)
    writeSecond(env, rec, slowProg, bars, kind === 'pizz' ? 'section' : kind, 10, 'fm3')
    emit(env, rec, 'fm4', slowTheme, { vel: 12 })
    writeEcho(rec, 'fm4', 'sq2', 3, ECHO_VEL, total)
    for (let b = 0; b < last; b += 2) {
      const t = timp(slowProg[b % slowProg.length], 'tonic')
      if (t !== null) beat(rec, b * spb, t, 9)
    }
    const chargeFrom = Math.max(0, bars - 2) * spb
    hum(env, rec, 0, Math.max(0, bars - 2), 7)
    charge(env, rec, chargeFrom, total)
    if (bars > 2) thunder(rec, 2 * spb + 4, false, total, noise)
    roll(rec, last * spb, total, TIMP_V, 6, 13)
    rain(env, rec, bars, 12, noise)
  })

  addSection(song, 'FINAL', bars, 2, (rec) => {
    const noise: [number, number][] = []
    strike(env, rec, 0, total, noise)
    // a mitad de la sección cae otro, más cerca todavía
    if (half > 0) strike(env, rec, half * spb, total, noise)
    drive(env, rec, prog, bars, { snare: true, vel: 15 })
    writeCellos(env, rec, prog, bars, cB)
    writeSpiccato(env, rec, prog, bars, figB, { vel: 12 })
    writeSecond(env, rec, prog, bars, kind, 12)
    emit(env, rec, 'fm4', theme)
    emit(env, rec, 'sq3', second(theme), { vel: VOICE2_VEL })
    writeEcho(rec, 'fm4', 'sq2', 3, ECHO_VEL - 1, total)
    rain(env, rec, bars, 9, noise)
  })

  addSection(song, 'OUTRO', bars, 1, (rec) => {
    // la tormenta se aleja: cadencia, un último rayo sobre la tónica y truenos cada vez más lejos
    const noise: [number, number][] = []
    const out = Math.max(1, bars - 2)
    drive(env, rec, outProg, out, { vel: 12 })
    writeCellos(env, rec, outProg, out, cA, { vel: 11 })
    writeSpiccato(env, rec, outProg, bars, figA, { vel: 10, to: out })
    writeSecond(env, rec, outProg, bars, kind, 10)
    if (bars > 4) emit(env, rec, 'fm4', theme.filter((n) => n.step < 2 * spb), { vel: 12 })
    if (bars > 1) {
      put(rec, 'fm1', (last - 1) * spb, 8, bassRoot(env, CH.V), 12)
      roll(rec, (last - 1) * spb + 8, last * spb, TIMP_V, 5, 12)
    }
    strike(env, rec, last * spb, total, noise)
    put(rec, 'fm1', last * spb, spb, bassRoot(env, CH.i), 13)
    put(rec, 'fm4', last * spb, 12, env.midTonic + 12, 12)
    if (half > 1) thunder(rec, 1 * spb + 8, false, total, noise)
    rain(env, rec, bars, 11, noise)
  })

  song.loopStart = 1
}

// ═════════════════════════════════════════════════════════════════════════════
//  Rellenar una pista
// ═════════════════════════════════════════════════════════════════════════════
/** Notas nuevas para una pista con el lenguaje de TORMENTA; el tema (lead) se escribe como en COSMIC. */
export function stormTrackNotes(song: Song, pat: Pattern, trackId: string, kind: FillKind, rng: Rng): Note[] {
  const minor = song.scale === 'minor' || song.scale === 'harmonicMinor'
  if (kind === 'lead' || !minor) return electroTrackNotes(song, pat, trackId, kind, rng, 'cosmic')
  const env = makeEnv(song, rng)
  const bars = pat.bars
  const total = bars * env.spb
  const pd = rng.pick(COSMIC_PROGS)
  const prog: Harm[] = bars < 8 ? pd.short : pd.full
  const tr = song.tracks.find((t) => t.id === trackId)
  const rec: NoteRec = {}
  let from = trackId
  switch (kind) {
    case 'bass':
      writeCellos(env, rec, prog, bars, rng.pick(CELLOS))
      from = 'fm1'
      break
    case 'chords':
      writeSecond(env, rec, prog, bars, rng.pick(['section', 'ponti'] as const), 11, trackId)
      break
    case 'arp':
      writeSpiccato(env, rec, prog, bars, rng.pick(FIGURES), { vel: 12 })
      from = 'fm2'
      break
    case 'drums':
      drive(env, rec, prog, bars, { snare: rng.chance(0.5) })
      from = tr?.kind === 'noise' ? 'noise' : 'ch6'
      break
    case 'perc': {
      // la tormenta: un rayo al principio, la carga al final y la lluvia entre truenos
      const noise: [number, number][] = []
      strike(env, rec, 0, total, noise)
      if (bars > 1) charge(env, rec, (bars - 1) * env.spb, total)
      rain(env, rec, bars, 10, noise)
      from = tr?.kind === 'noise' ? 'noise' : 'ch6'
      break
    }
  }
  const drumKind = kind === 'drums' || kind === 'perc'
  if (drumKind && tr?.kind !== 'dac' && tr?.kind !== 'noise') return []
  const max = patternSteps(song, pat)
  return (rec[from] ?? [])
    .filter((n) => n.step < max)
    .map((n) => ({ ...n, len: Math.max(1, Math.min(n.len, max - n.step)) }))
    .sort((a, b) => a.step - b.step || a.note - b.note)
}
