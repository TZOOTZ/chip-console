// ── Del registro del SN76489 a notas ───────────────────────────────────────────────
//
// Una nota de las tres cuadradas es un tramo en que su volumen no está en 15 (apagado); la altura sale del periodo
// (con el mismo tratamiento de vibratos, ligados y arpegios que el FM) y la velocidad, del volumen al empezar. El
// canal de ruido da golpes con su tipo (blanco/periódico) y su velocidad de reloj.
import { hzToMidi } from '../core/chipmath'
import { pitchParts, type PitchPart } from './ymTrack'

export interface PsgNote {
  ch: number
  t0: number
  t1: number
  parts: PitchPart[]
  /** velocidad 1-15 (15 − atenuación más baja de los primeros frames) */
  vel: number
  /** cuánto baja el volumen durante la nota (pasos de atenuación): una nota con caída es un pluck */
  decay: number
}

export interface NoiseNote {
  t0: number
  t1: number
  white: boolean
  /** 0-2 = frecuencia fija (alta → baja) · 3 = la del tercer tono */
  rate: number
  vel: number
}

export interface PsgResult {
  notes: PsgNote[]
  noise: NoiseNote[]
}

const FRAME = 735

interface Voice {
  on: boolean
  t0: number
  log: { t: number; midi: number }[]
  /** [t, atenuación] mientras suena */
  att: [number, number][]
  white: boolean
  rate: number
}

const voice = (): Voice => ({ on: false, t0: 0, log: [], att: [], white: true, rate: 0 })

export function trackPsg(writes: { t: number; val: number }[], clock: number): PsgResult {
  const out: PsgResult = { notes: [], noise: [] }
  const period = [0, 0, 0]
  const att = [15, 15, 15, 15]
  const v = [voice(), voice(), voice(), voice()]
  let noiseCtl = 0
  let latchCh = 0
  let latchType = 0
  const midi = (ch: number): number => hzToMidi(clock / (32 * Math.max(1, period[ch])))

  const peak = (a: [number, number][], t0: number): number => Math.min(...a.filter(([t]) => t < t0 + 3 * FRAME).map(([, x]) => x), 15)
  const finish = (ch: number, t: number): void => {
    const s = v[ch]
    if (!s.on) return
    s.on = false
    if (t <= s.t0) return
    const best = peak(s.att, s.t0)
    const vel = Math.max(1, Math.min(15, 15 - best))
    if (ch === 3) {
      out.noise.push({ t0: s.t0, t1: t, white: s.white, rate: s.rate, vel })
      return
    }
    const parts = pitchParts(s.log, s.t0, t)
    if (parts.length === 0) return
    const last = s.att.length ? s.att[s.att.length - 1][1] : best
    out.notes.push({ ch, t0: s.t0, t1: t, parts, vel, decay: Math.max(0, Math.min(14, last - best)) })
  }
  const start = (ch: number, t: number): void => {
    const s = v[ch]
    s.on = true
    s.t0 = t
    s.att = [[t, att[ch]]]
    s.log = ch < 3 ? [{ t, midi: midi(ch) }] : []
    s.white = (noiseCtl & 4) !== 0
    s.rate = noiseCtl & 3
  }
  const setAtt = (ch: number, a: number, t: number): void => {
    const before = att[ch]
    att[ch] = a
    if (a < 15 && before === 15) start(ch, t)
    else if (a === 15 && before < 15) finish(ch, t)
    else if (a < 15 && v[ch].on) v[ch].att.push([t, a])
  }
  const setPeriod = (ch: number, p: number, t: number): void => {
    period[ch] = p
    if (v[ch].on && p > 0) v[ch].log.push({ t, midi: midi(ch) })
  }

  for (const { t, val } of writes) {
    if (val & 0x80) {
      latchCh = (val >> 5) & 3
      latchType = (val >> 4) & 1
      const d = val & 15
      if (latchType === 1) setAtt(latchCh, d, t)
      else if (latchCh === 3) noiseCtl = d
      else setPeriod(latchCh, (period[latchCh] & 0x3f0) | d, t)
    } else if (latchType === 1) setAtt(latchCh, val & 15, t)
    else if (latchCh < 3) setPeriod(latchCh, ((val & 0x3f) << 4) | (period[latchCh] & 15), t)
  }
  const end = writes.length ? writes[writes.length - 1].t : 0
  for (let ch = 0; ch < 4; ch++) finish(ch, end)
  return out
}
