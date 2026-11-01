// ── Consola: YM2612 + SN76489 → audio a la tasa de salida ───────────────────
//
// Cada chip corre a su tasa nativa (≈53 kHz el FM, ≈224 kHz el PSG).
//   · FM: promedio por área hasta la tasa de salida (su contenido por encima de
//     Nyquist es mínimo).
//   · PSG: las cuadradas tienen armónicos hasta el infinito, así que se lleva
//     primero a 4× la tasa de salida (promedio por área) y de ahí se diezma con
//     un FIR de fase lineal: el aliasing queda unos 50 dB más abajo que con el
//     promedio solo.
// La consola tiene dos caracteres de sonido (`model`):
//   · 'md1'   Mega Drive Model 1: YM2612 discreto (DAC de 9 bits con su escalón
//             en el cruce por cero) y el paso-bajo de primer orden de la placa.
//   · 'clean' suma ideal a 14 bits, sin filtro.
// El balance FM/PSG es el mismo en los dos y está calibrado contra emuladores
// de referencia, no a ojo (ver PSG_GAIN).
import { SN76489, SN76489_CLOCK_NTSC } from './sn76489'
import { YM2612, YM2612_CLOCK_NTSC } from './ym2612'

export type SoundModel = 'md1' | 'clean'

export interface ConsoleOptions {
  sampleRate: number
  ymClock?: number
  psgClock?: number
  model?: SoundModel
}

/**
 * Nivel del PSG frente al FM. Un canal FM a tope vale ±0.25 y uno del PSG ±0.5 · PSG_GAIN,
 * es decir, 10,9 dB por debajo. Queda entre las dos referencias disponibles: libgme
 * (medido: −9,8 dB) y Genesis Plus GX, ajustado por su autor a una Model 1 (−11,8 dB).
 */
export const PSG_GAIN = 0.143

/** corte del paso-bajo de primer orden de la etapa de audio de la Model 1 (Hz) */
export const MD1_LOWPASS_HZ = 3390

// ── filtro de diezmado del PSG ──────────────────────────────────────────────
const PSG_OS = 4
const FIR_TAPS = 96
const FIR_RING = 128
const FIR_MASK = FIR_RING - 1
/** retardo de grupo del FIR en muestras de salida (47,5 / 4): el FM se retrasa lo mismo */
const FM_DELAY = 12
const FM_RING = 16
const FM_MASK = FM_RING - 1

/** paso-bajo de sinc enventanado (Kaiser): `fc` en ciclos por muestra, suma de coeficientes = 1 */
function kaiserLowpass(taps: number, fc: number, beta: number): Float64Array {
  const i0 = (x: number): number => {
    let sum = 1
    let term = 1
    for (let k = 1; k < 32; k++) {
      term *= (x / (2 * k)) ** 2
      sum += term
    }
    return sum
  }
  const h = new Float64Array(taps)
  const mid = (taps - 1) / 2
  let total = 0
  for (let n = 0; n < taps; n++) {
    const x = n - mid
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x)
    h[n] = (sinc * i0(beta * Math.sqrt(1 - (x / mid) ** 2))) / i0(beta)
    total += h[n]
  }
  for (let n = 0; n < taps; n++) h[n] /= total
  return h
}
/** corte en el Nyquist de salida; ~60 dB de rechazo a partir de 0,58 · fs */
const PSG_FIR = kaiserLowpass(FIR_TAPS, 0.5 / PSG_OS, 5.65)

export class ChipConsole {
  readonly ym: YM2612
  readonly psg: SN76489
  readonly sampleRate: number

  /** ganancias de mezcla */
  fmGain = 1.0
  psgGain = PSG_GAIN

  /** última muestra estéreo (tras filtros + limitador suave) */
  l = 0
  r = 0

  private sound: SoundModel = 'md1'
  private readonly ymStep: number
  /** pasos del PSG por submuestra (a 4× la tasa de salida) */
  private readonly psgStep: number
  private ymL = 0
  private ymR = 0
  private ymRemain = 0
  private psgCur = 0
  private psgRemain = 0
  private readonly psgRing = new Float64Array(FIR_RING)
  private psgPos = 0
  private readonly fmRingL = new Float64Array(FM_RING)
  private readonly fmRingR = new Float64Array(FM_RING)
  private fmPos = 0

  // paso-bajo de la Model 1 (un polo)
  private readonly lpA: number
  private lpOn = true
  private lpL = 0
  private lpR = 0

  // Filtro subsónico: paso-alto Butterworth de 2º orden a 20 Hz. Quita la continua (DAC en
  // reposo, desplazamiento del DAC discreto) y el "golpe" de muy baja frecuencia que deja cada
  // nota FM con modulador 1:1 (su banda lateral cae en 0 Hz), sin tocar los graves musicales.
  private readonly hpB0: number
  private readonly hpB1: number
  private readonly hpA1: number
  private readonly hpA2: number
  private xl1 = 0
  private xl2 = 0
  private yl1 = 0
  private yl2 = 0
  private xr1 = 0
  private xr2 = 0
  private yr1 = 0
  private yr2 = 0

  constructor(opts: ConsoleOptions) {
    this.sampleRate = opts.sampleRate
    this.ym = new YM2612(opts.ymClock ?? YM2612_CLOCK_NTSC)
    this.psg = new SN76489(opts.psgClock ?? SN76489_CLOCK_NTSC)
    this.ymStep = this.ym.rate / this.sampleRate
    this.psgStep = this.psg.rate / (this.sampleRate * PSG_OS)
    this.lpA = 1 - Math.exp((-2 * Math.PI * MD1_LOWPASS_HZ) / this.sampleRate)
    const w0 = (2 * Math.PI * 20) / this.sampleRate
    const cos = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
    const a0 = 1 + alpha
    this.hpB0 = (1 + cos) / 2 / a0
    this.hpB1 = -(1 + cos) / a0
    this.hpA1 = (-2 * cos) / a0
    this.hpA2 = (1 - alpha) / a0
    this.model = opts.model ?? 'md1'
  }

  get model(): SoundModel {
    return this.sound
  }
  /** paso-bajo de la Model 1 (lo fija `model`; se puede quitar para medir el DAC a solas) */
  get lowpass(): boolean {
    return this.lpOn
  }
  set lowpass(on: boolean) {
    this.lpOn = on
  }
  set model(m: SoundModel) {
    const before = this.restDc()
    this.sound = m
    this.ym.discrete = m === 'md1'
    this.lpOn = m === 'md1'
    this.shiftDc(this.restDc() - before)
  }

  reset(): void {
    this.ym.reset()
    this.psg.reset()
    this.ymRemain = 0
    this.psgRemain = 0
    this.ymL = this.ymR = this.psgCur = 0
    this.psgRing.fill(0)
    this.psgPos = 0
    this.settle()
  }

  /** continua del YM2612 en silencio: en el DAC discreto cada uno de los seis canales vale +4 LSB */
  private restDc(): number {
    return this.ym.discrete && this.ym.ladder ? 24 / 1024 : 0
  }

  /** deja los filtros en reposo sobre la continua del chip en silencio (sin golpe al arrancar) */
  private settle(): void {
    const raw = this.restDc()
    const dc = raw * this.fmGain
    this.ymL = this.ymR = raw
    this.fmRingL.fill(dc)
    this.fmRingR.fill(dc)
    this.lpL = this.lpR = dc
    this.xl1 = this.xl2 = this.xr1 = this.xr2 = dc
    this.yl1 = this.yl2 = this.yr1 = this.yr2 = 0
  }

  /**
   * Al cambiar de modelo con la música sonando cambia la continua del chip: se desplaza todo lo
   * que la lleva dentro (línea de retardo, paso-bajo y la memoria de entrada del subsónico), que
   * es justo el estado que tendrían los filtros si esa continua hubiera estado siempre ahí.
   */
  private shiftDc(raw: number): void {
    if (raw === 0) return
    const d = raw * this.fmGain
    this.ymL += raw
    this.ymR += raw
    for (let i = 0; i < FM_RING; i++) {
      this.fmRingL[i] += d
      this.fmRingR[i] += d
    }
    this.lpL += d
    this.lpR += d
    this.xl1 += d
    this.xl2 += d
    this.xr1 += d
    this.xr2 += d
  }

  /** Genera una muestra de salida (resultado en this.l / this.r). */
  renderSample(): void {
    const ym = this.ym
    // FM: promedio por área sobre [t, t + ymStep)
    let need = this.ymStep
    let sl = 0
    let sr = 0
    while (need > 1e-9) {
      if (this.ymRemain <= 1e-9) {
        ym.tick()
        this.ymL = ym.outL
        this.ymR = ym.outR
        this.ymRemain = 1
      }
      const take = need < this.ymRemain ? need : this.ymRemain
      sl += this.ymL * take
      sr += this.ymR * take
      need -= take
      this.ymRemain -= take
    }
    const inv = this.fmGain / this.ymStep
    // el FM espera lo que tarda el filtro del PSG
    const fp = (this.fmPos + 1) & FM_MASK
    this.fmPos = fp
    this.fmRingL[fp] = sl * inv
    this.fmRingR[fp] = sr * inv
    const fl = this.fmRingL[(fp - FM_DELAY) & FM_MASK]
    const fr = this.fmRingR[(fp - FM_DELAY) & FM_MASK]

    // PSG: cuatro submuestras por muestra de salida…
    const psg = this.psg
    const ring = this.psgRing
    const step = this.psgStep
    let pos = this.psgPos
    for (let k = 0; k < PSG_OS; k++) {
      need = step
      let acc = 0
      while (need > 1e-9) {
        if (this.psgRemain <= 1e-9) {
          this.psgCur = psg.tick()
          this.psgRemain = 1
        }
        const take = need < this.psgRemain ? need : this.psgRemain
        acc += this.psgCur * take
        need -= take
        this.psgRemain -= take
      }
      pos = (pos + 1) & FIR_MASK
      ring[pos] = acc / step
    }
    this.psgPos = pos
    // …y el filtro de diezmado
    let sp = 0
    for (let j = 0; j < FIR_TAPS; j++) sp += PSG_FIR[j] * ring[(pos - j) & FIR_MASK]
    sp *= this.psgGain

    let xl = fl + sp
    let xr = fr + sp
    // el paso-bajo corre siempre (así entra y sale sin salto); solo se escucha en la Model 1
    this.lpL += this.lpA * (xl - this.lpL)
    this.lpR += this.lpA * (xr - this.lpR)
    if (this.lpOn) {
      xl = this.lpL
      xr = this.lpR
    }
    // filtro subsónico (b2 = b0)
    const yl = this.hpB0 * (xl + this.xl2) + this.hpB1 * this.xl1 - this.hpA1 * this.yl1 - this.hpA2 * this.yl2
    this.xl2 = this.xl1
    this.xl1 = xl
    this.yl2 = this.yl1
    this.yl1 = yl
    const yr = this.hpB0 * (xr + this.xr2) + this.hpB1 * this.xr1 - this.hpA1 * this.yr1 - this.hpA2 * this.yr2
    this.xr2 = this.xr1
    this.xr1 = xr
    this.yr2 = this.yr1
    this.yr1 = yr

    this.l = softClip(yl)
    this.r = softClip(yr)
  }

  /** Renderiza n muestras a los buffers dados. */
  render(outL: Float32Array, outR: Float32Array, n: number, offset = 0): void {
    for (let i = 0; i < n; i++) {
      this.renderSample()
      outL[offset + i] = this.l
      outR[offset + i] = this.r
    }
  }
}

/** limitador suave: lineal hasta 0.8, curva tanh por encima (nunca pasa de ±1) */
export function softClip(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.8) return x
  const y = 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2)
  return x < 0 ? -y : y
}
