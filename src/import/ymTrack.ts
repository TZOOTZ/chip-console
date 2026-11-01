// ── Del registro del YM2612 a notas, parches y golpes de DAC ───────────────────────
//
// Se sigue el estado de los seis canales (operadores, algoritmo, frecuencia, panorama) y cada key-on/key-off es una
// nota. El parche es el de los registros en el key-on; la altura sale del F-num y el bloque. Lo que se mueve mientras
// suena se trata así: un vibrato o un barrido de tono corto (menos de 4 frames) no es otra nota; una altura que se
// mantiene 4 frames o más sí (nota ligada); y un arpegio rápido es un acorde en una sola pista, como lo escribe la app.
import { hzToMidi, ymHzFromFreq } from '../core/chipmath'
import type { YmWrite } from './vgmParse'

export interface FmOpRegs {
  dt: number
  mul: number
  tl: number
  rs: number
  ar: number
  am: number
  d1r: number
  d2r: number
  sl: number
  rr: number
}

export interface FmSnap {
  alg: number
  fb: number
  /** bits de panorama del registro 0xB4: 3 = centro · 2 = izquierda · 1 = derecha */
  pan: number
  ams: number
  pms: number
  /** operadores en orden lógico OP1..OP4 */
  ops: FmOpRegs[]
}

export interface PitchPart {
  t0: number
  t1: number
  note: number
  slide: boolean
}

export interface FmVoiceNote {
  ch: number
  t0: number
  t1: number
  parts: PitchPart[]
  snap: FmSnap
  /** TL más bajo (más fuerte) de las portadoras en el key-on */
  carTl: number
}

export interface DacHit {
  t0: number
  t1: number
  pcm: Uint8Array
  /** Hz */
  rate: number
  /** si sale del banco de PCM del VGM: dónde empieza y cuánto dura (dos disparos de la misma muestra comparten clave) */
  key?: string
}

export interface YmResult {
  notes: FmVoiceNote[]
  hits: DacHit[]
  /** LFO de la canción en el formato de la app (0 = apagado, 1-8) */
  lfo: number
  dacOn: boolean
  warnings: string[]
}

/** qué operadores son portadoras en cada algoritmo (orden lógico OP1..OP4) */
export const CARRIER_OPS: boolean[][] = [
  [false, false, false, true],
  [false, false, false, true],
  [false, false, false, true],
  [false, false, false, true],
  [false, true, false, true],
  [false, true, true, true],
  [false, true, true, true],
  [true, true, true, true],
]

const FRAME = 735
const STABLE = 4 * FRAME
/** el registro de cada operador (desplazamiento 0, 4, 8, 12) → operador lógico */
const SLOT_OP = [0, 2, 1, 3]

const blankOp = (): FmOpRegs => ({ dt: 0, mul: 1, tl: 127, rs: 0, ar: 31, am: 0, d1r: 0, d2r: 0, sl: 0, rr: 15 })

interface Chan {
  snap: FmSnap
  fnumHi: number
  block: number
  fnum: number
  keyed: boolean
  t0: number
  start: FmSnap | null
  log: { t: number; midi: number }[]
}

const cloneSnap = (s: FmSnap): FmSnap => ({ ...s, ops: s.ops.map((o) => ({ ...o })) })

const midiOf = (fnum: number, block: number, clock: number): number => hzToMidi(fnum > 0 ? ymHzFromFreq(fnum, block, clock) : 440)

/** divide la altura de una nota en partes: notas ligadas estables o, si no hay, las alturas de un arpegio */
export function pitchParts(log: { t: number; midi: number }[], t0: number, t1: number): PitchPart[] {
  // altura vigente al empezar (la que se escribió antes del key-on) y cambios dentro de la nota
  let before: number | null = null
  const inside: { t: number; midi: number }[] = []
  for (const e of log) {
    if (e.t <= t0) before = e.midi
    else if (e.t < t1) inside.push(e)
  }
  const seq = before === null ? inside : [{ t: t0, midi: before }, ...inside]
  if (seq.length === 0) return []
  // redondeo con histéresis: un vibrato de ±50 cents no cambia de nota
  const runs: PitchPart[] = []
  let cur = Math.round(seq[0].midi)
  let at = t0
  for (let i = 1; i < seq.length; i++) {
    if (Math.abs(seq[i].midi - cur) > 0.65) {
      runs.push({ t0: at, t1: seq[i].t, note: cur, slide: false })
      cur = Math.round(seq[i].midi)
      at = seq[i].t
    }
  }
  runs.push({ t0: at, t1, note: cur, slide: false })
  const merged: PitchPart[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && last.note === r.note) last.t1 = r.t1
    else merged.push({ ...r })
  }
  const total = t1 - t0
  if (merged.length === 1) return merged
  const stable = merged.filter((r) => r.t1 - r.t0 >= STABLE)
  if (stable.length > 0 && stable.reduce((n, r) => n + (r.t1 - r.t0), 0) >= 0.6 * total) {
    // dos tramos estables de la misma nota separados por un tropiezo de tono son uno solo
    const joined: PitchPart[] = []
    for (const r of stable) {
      const last = joined[joined.length - 1]
      if (last && last.note === r.note) last.t1 = r.t1
      else joined.push({ ...r })
    }
    // el cambio de nota empieza donde la anterior dejó de sonar estable: lo que hay entre medias (un barrido de tono
    // que pasa por otras alturas) es la entrada de la nueva nota, no una nota aparte
    return joined.map((r, i) => ({ t0: i === 0 ? t0 : joined[i - 1].t1, t1: i + 1 < joined.length ? r.t1 : t1, note: r.note, slide: i > 0 }))
  }
  // sin alturas estables: un arpegio (acorde en una pista) o un golpe de tono; se quedan las que más suenan
  const dwell = new Map<number, number>()
  for (const r of merged) dwell.set(r.note, (dwell.get(r.note) ?? 0) + (r.t1 - r.t0))
  const ranked = [...dwell.entries()].sort((a, b) => b[1] - a[1])
  const keep = total < 6 * FRAME ? ranked.slice(0, 1) : ranked.filter(([, d]) => d >= 0.1 * total).slice(0, 4)
  return (keep.length ? keep : ranked.slice(0, 1)).map(([note]) => ({ t0, t1, note, slide: false }))
}

export function trackYm(writes: YmWrite[], clock: number): YmResult {
  const chans: Chan[] = Array.from({ length: 6 }, () => ({
    snap: { alg: 0, fb: 0, pan: 3, ams: 0, pms: 0, ops: [blankOp(), blankOp(), blankOp(), blankOp()] },
    fnumHi: 0,
    block: 0,
    fnum: 0,
    keyed: false,
    t0: 0,
    start: null,
    log: [],
  }))
  const out: YmResult = { notes: [], hits: [], lfo: 0, dacOn: false, warnings: [] }
  const dac: { t: number; val: number; bank?: number }[] = []
  let dacOn = false
  let ssg = false
  let special = false
  const finish = (c: Chan, ch: number, t: number): void => {
    if (!c.keyed || !c.start) return
    c.keyed = false
    if (t <= c.t0) return
    const parts = pitchParts(c.log, c.t0, t)
    if (parts.length === 0) return
    const car = CARRIER_OPS[c.start.alg]
    out.notes.push({ ch, t0: c.t0, t1: t, parts, snap: c.start, carTl: Math.min(...c.start.ops.filter((_, i) => car[i]).map((o) => o.tl)) })
  }
  for (const w of writes) {
    const { t, port, reg, val } = w
    if (port === 0 && reg === 0x28) {
      const sel = val & 7
      if (sel === 3 || sel === 7) continue
      const ch = sel < 3 ? sel : sel - 1
      const c = chans[ch]
      if (val & 0xf0) {
        if (c.keyed) finish(c, ch, t)
        c.keyed = true
        c.t0 = t
        c.start = cloneSnap(c.snap)
        // la altura vigente al empezar es la que ya estaba escrita en el canal
        c.log.push({ t, midi: midiOf(c.fnum, c.block, clock) })
      } else finish(c, ch, t)
    } else if (port === 0 && reg === 0x2a) {
      if (dacOn) dac.push({ t, val, bank: w.bank })
    } else if (port === 0 && reg === 0x2b) {
      dacOn = (val & 0x80) !== 0
      if (dacOn) out.dacOn = true
    } else if (port === 0 && reg === 0x22) {
      if (val & 8) out.lfo = (val & 7) + 1
    } else if (port === 0 && reg === 0x27) {
      if (val & 0xc0) special = true
    } else if (reg >= 0x30 && reg <= 0x9f) {
      const cc = reg & 3
      if (cc === 3) continue
      const op = chans[port * 3 + cc].snap.ops[SLOT_OP[(reg & 0x0c) >> 2]]
      switch (reg & 0xf0) {
        case 0x30:
          op.dt = (val >> 4) & 7
          op.mul = val & 15
          break
        case 0x40:
          op.tl = val & 127
          break
        case 0x50:
          op.rs = val >> 6
          op.ar = val & 31
          break
        case 0x60:
          op.am = (val >> 7) & 1
          op.d1r = val & 31
          break
        case 0x70:
          op.d2r = val & 31
          break
        case 0x80:
          op.sl = val >> 4
          op.rr = val & 15
          break
        default:
          if (val & 15) ssg = true
          break
      }
    } else if (reg >= 0xa0 && reg <= 0xb6) {
      const cc = reg & 3
      if (cc === 3) continue
      const c = chans[port * 3 + cc]
      if (reg >= 0xb4) {
        c.snap.pan = val >> 6
        c.snap.ams = (val >> 4) & 3
        c.snap.pms = val & 7
      } else if (reg >= 0xb0) {
        c.snap.alg = val & 7
        c.snap.fb = (val >> 3) & 7
      } else if (reg >= 0xa4) {
        // el byte alto se retiene hasta que llega el bajo
        c.fnumHi = val & 7
        c.block = (val >> 3) & 7
      } else {
        c.fnum = (c.fnumHi << 8) | val
        if (c.keyed || c.log.length === 0) c.log.push({ t, midi: midiOf(c.fnum, c.block, clock) })
      }
    }
  }
  const end = writes.length ? writes[writes.length - 1].t : 0
  chans.forEach((c, ch) => finish(c, ch, end))
  out.hits = dacHits(dac)
  if (ssg) out.warnings.push('El VGM usa SSG-EG (envolvente de grano): no se reproduce')
  if (special) out.warnings.push('El VGM usa el modo especial del canal 3 (tres frecuencias): se toca como un canal normal')
  return out
}

/** golpes de DAC: tandas de escrituras seguidas, remuestreadas a una frecuencia fija */
function dacHits(log: { t: number; val: number; bank?: number }[]): DacHit[] {
  const GAP = 600
  const out: DacHit[] = []
  let run: { t: number; val: number; bank?: number }[] = []
  const flush = (): void => {
    const n = run.length
    if (n >= 16) {
      const gaps = run.slice(1).map((e, i) => e.t - run[i].t).sort((a, b) => a - b)
      // el intervalo de muestreo: el corto más repetido (si solo se escribe lo que cambia, los demás son múltiplos)
      const dt = Math.max(1, gaps[Math.floor(gaps.length * 0.1)] ?? 3)
      const len = Math.min(24576, Math.round((run[n - 1].t - run[0].t) / dt) + 1)
      const pcm = new Uint8Array(len)
      let j = 0
      for (let k = 0; k < len; k++) {
        const at = run[0].t + k * dt
        while (j + 1 < n && run[j + 1].t <= at) j++
        pcm[k] = run[j].val
      }
      let lo = 0
      let hi = len
      while (lo < hi - 32 && Math.abs(pcm[lo] - 128) <= 2) lo++
      while (hi > lo + 32 && Math.abs(pcm[hi - 1] - 128) <= 2) hi--
      const body = pcm.slice(lo, hi)
      if (body.some((v) => Math.abs(v - 128) > 3)) out.push({ t0: run[0].t, t1: run[n - 1].t, pcm: body, rate: Math.max(4000, Math.min(44100, Math.round(44100 / dt))), ...(run[0].bank !== undefined ? { key: `${run[0].bank}:${n}` } : {}) })
    }
    run = []
  }
  for (const e of log) {
    const last = run[run.length - 1]
    // una muestra acaba cuando se deja de escribir o cuando el banco salta a otra (un disparo nuevo)
    if (last && (e.t - last.t > GAP || (e.bank !== undefined && last.bank !== undefined && e.bank !== last.bank + 1))) flush()
    run.push(e)
  }
  flush()
  return out
}
