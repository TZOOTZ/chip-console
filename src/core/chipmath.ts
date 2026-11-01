// ── Conversión nota/frecuencia ↔ valores de registro de los chips ───────────
import { YM2612_CLOCK_NTSC, YM2612_DIVIDER } from './ym2612'
import { SN76489_CLOCK_NTSC } from './sn76489'

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)
export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440)

export interface YmFreq {
  fnum: number
  block: number
}

/** Frecuencia → (fnum, block) del YM2612, eligiendo el bloque con más resolución. */
export function ymFreqFromHz(hz: number, clock = YM2612_CLOCK_NTSC): YmFreq {
  const base = clock / YM2612_DIVIDER
  for (let block = 0; block < 8; block++) {
    const fn = (hz * 2097152) / (base * (1 << block))
    if (fn <= 2047.49) return { fnum: Math.max(1, Math.round(fn)), block }
  }
  return { fnum: 2047, block: 7 }
}

/** (fnum, block) → Hz reales que produce el chip. */
export function ymHzFromFreq(fnum: number, block: number, clock = YM2612_CLOCK_NTSC): number {
  const base = clock / YM2612_DIVIDER
  return (fnum * (1 << block) * base) / 2097152
}

/** Hz → periodo de 10 bits del SN76489 (1-1023). */
export function psgPeriodFromHz(hz: number, clock = SN76489_CLOCK_NTSC): number {
  const p = Math.round(clock / (32 * hz))
  return Math.max(1, Math.min(1023, p))
}

/** periodo → Hz reales que produce el chip */
export function psgHzFromPeriod(period: number, clock = SN76489_CLOCK_NTSC): number {
  return clock / (32 * Math.max(1, period))
}

/** nota MIDI más grave que el PSG puede generar (periodo 1023 ≈ 109 Hz → A2) */
export const PSG_LOWEST_MIDI = 45
