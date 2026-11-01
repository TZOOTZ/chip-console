// ── YM2612 (OPN2) · emulación del chip FM de la Mega Drive ───────────────────
//
// Port a TypeScript, con cambios, del ym2612.c de Genesis Plus GX (© Eke-Eke), que parte
// del fm.c de MAME (© Jarek Burczynski y Tatsuyuki Satoh). Su licencia y sus avisos están
// en LICENSE-ym2612.txt. Sin DOM: corre en un AudioWorklet, en un Worker o en Node
// (tests / exportación offline).
//
//  · 6 canales × 4 operadores, los 8 algoritmos, realimentación del operador 1
//  · generador de envolvente con las tablas de tasas del chip (AR/D1R/D2R/RR/SL/KS)
//  · detune (DT), multiplicador (MUL), TL de 7 bits, LFO (AM/PM), DAC en el canal 6
//  · modo de salida estéreo por canal (pan L/R)
//  · etapa de salida a elegir: suma ideal a 14 bits o el DAC del YM2612 discreto
//    (9 bits por canal y la discontinuidad en el cruce por cero, el "ladder effect")
//
// El chip trabaja a clock/144 ≈ 53 267 Hz. `tick()` produce una muestra a esa
// tasa; el remuestreo a la tasa del AudioContext lo hace `Console` (mixer.ts).

export const YM2612_CLOCK_NTSC = 7_670_454
export const YM2612_CLOCK_PAL = 7_600_489
export const YM2612_DIVIDER = 144

// ── constantes de las tablas ────────────────────────────────────────────────
const ENV_BITS = 10
const ENV_LEN = 1 << ENV_BITS // 1024
const ENV_STEP = 128.0 / ENV_LEN
const MAX_ATT_INDEX = ENV_LEN - 1
const MIN_ATT_INDEX = 0

const EG_OFF = 0
const EG_REL = 1
const EG_SUS = 2
const EG_DEC = 3
const EG_ATT = 4

const SIN_BITS = 10
const SIN_LEN = 1 << SIN_BITS
const SIN_MASK = SIN_LEN - 1

const TL_RES_LEN = 256
const TL_TAB_LEN = 13 * 2 * TL_RES_LEN
const ENV_QUIET = TL_TAB_LEN >> 3

const FREQ_SH = 16

/** orden de los slots en los registros: S1(op1) S3(op3) S2(op2) S4(op4) */
const K_OP1 = 0
const K_OP3 = 1
const K_OP2 = 2
const K_OP4 = 3

// ── tablas (se generan una sola vez al cargar el módulo) ────────────────────
const TL_TAB = new Int16Array(TL_TAB_LEN)
const SIN_TAB = new Uint16Array(SIN_LEN)
const SL_TABLE = new Int32Array(16)
const EG_INC = new Uint8Array(19 * 8)
const EG_RATE_SELECT = new Uint8Array(128)
const EG_RATE_SHIFT = new Uint8Array(128)
const DT_TAB: Int32Array[] = []
const PM_DELTA: Float64Array[] = []

const FN_KEY = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3]
const LFO_SAMPLES_PER_STEP = [108, 77, 71, 67, 62, 44, 8, 5]
const AMS_SHIFT = [8, 3, 1, 0]
/** profundidad del vibrato hardware en cents por valor de PMS (manual Yamaha) */
const PMS_CENTS = [0, 3.4, 6.7, 10, 14, 20, 40, 80]

const EG_INC_ROWS: number[][] = [
  [0, 1, 0, 1, 0, 1, 0, 1], // 0  tasas 00-11 · sub 0
  [0, 1, 0, 1, 1, 1, 0, 1], // 1
  [0, 1, 1, 1, 0, 1, 1, 1], // 2
  [0, 1, 1, 1, 1, 1, 1, 1], // 3
  [1, 1, 1, 1, 1, 1, 1, 1], // 4  tasa 12
  [1, 1, 1, 2, 1, 1, 1, 2], // 5
  [1, 2, 1, 2, 1, 2, 1, 2], // 6
  [1, 2, 2, 2, 1, 2, 2, 2], // 7
  [2, 2, 2, 2, 2, 2, 2, 2], // 8  tasa 13
  [2, 2, 2, 4, 2, 2, 2, 4], // 9
  [2, 4, 2, 4, 2, 4, 2, 4], // 10
  [2, 4, 4, 4, 2, 4, 4, 4], // 11
  [4, 4, 4, 4, 4, 4, 4, 4], // 12 tasa 14
  [4, 4, 4, 8, 4, 4, 4, 8], // 13
  [4, 8, 4, 8, 4, 8, 4, 8], // 14
  [4, 8, 8, 8, 4, 8, 8, 8], // 15
  [8, 8, 8, 8, 8, 8, 8, 8], // 16 tasa 15
  [16, 16, 16, 16, 16, 16, 16, 16], // 17 ataque instantáneo
  [0, 0, 0, 0, 0, 0, 0, 0], // 18 tasa infinita
]

/** detune en unidades 10.10 por [FD=0..3][key code 0..31] */
const DT_BASE = [
  // FD=0
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  // FD=1
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7,
  // FD=2
  1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 16, 16, 16,
  // FD=3
  2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 22, 22, 22, 22,
]

function initTables() {
  // tabla exponencial (atenuación → amplitud de 13 bits + signo)
  for (let x = 0; x < TL_RES_LEN; x++) {
    let m = (1 << 16) / Math.pow(2, ((x + 1) * (ENV_STEP / 4.0)) / 8.0)
    m = Math.floor(m)
    let n = m | 0
    n >>= 4
    n = n & 1 ? (n >> 1) + 1 : n >> 1
    n <<= 2
    TL_TAB[x * 2] = n
    TL_TAB[x * 2 + 1] = -n
    for (let i = 1; i < 13; i++) {
      const v = TL_TAB[x * 2] >> i
      TL_TAB[x * 2 + i * 2 * TL_RES_LEN] = v
      TL_TAB[x * 2 + 1 + i * 2 * TL_RES_LEN] = -v
    }
  }
  // seno logarítmico (verificado contra el chip real)
  for (let i = 0; i < SIN_LEN; i++) {
    const m = Math.sin(((i * 2 + 1) * Math.PI) / SIN_LEN)
    let o = m > 0 ? (8 * Math.log(1 / m)) / Math.log(2) : (8 * Math.log(-1 / m)) / Math.log(2)
    o = o / (ENV_STEP / 4)
    let n = Math.floor(2.0 * o)
    n = n & 1 ? (n >> 1) + 1 : n >> 1
    SIN_TAB[i] = n * 2 + (m >= 0 ? 0 : 1)
  }
  // nivel de sustain: pasos de 3 dB, el 15 salta a 93 dB
  for (let i = 0; i < 16; i++) {
    const db = i !== 15 ? i : 31
    SL_TABLE[i] = Math.floor(db * (4.0 / ENV_STEP))
  }
  // incrementos de envolvente
  for (let r = 0; r < EG_INC_ROWS.length; r++) {
    for (let c = 0; c < 8; c++) EG_INC[r * 8 + c] = EG_INC_ROWS[r][c]
  }
  for (let i = 0; i < 32; i++) {
    EG_RATE_SELECT[i] = 18 * 8
    EG_RATE_SHIFT[i] = 0
  }
  for (let r = 0; r < 48; r++) {
    EG_RATE_SELECT[32 + r] = (r & 3) * 8
    EG_RATE_SHIFT[32 + r] = 11 - (r >> 2)
  }
  for (let s = 0; s < 4; s++) {
    EG_RATE_SELECT[80 + s] = (4 + s) * 8
    EG_RATE_SHIFT[80 + s] = 0
    EG_RATE_SELECT[84 + s] = (8 + s) * 8
    EG_RATE_SHIFT[84 + s] = 0
    EG_RATE_SELECT[88 + s] = (12 + s) * 8
    EG_RATE_SHIFT[88 + s] = 0
    EG_RATE_SELECT[92 + s] = 16 * 8
    EG_RATE_SHIFT[92 + s] = 0
  }
  for (let i = 96; i < 128; i++) {
    EG_RATE_SELECT[i] = 16 * 8
    EG_RATE_SHIFT[i] = 0
  }
  // detune: unidades 10.10 → 16.16 (×64); FD 4-7 son los negativos
  for (let d = 0; d < 8; d++) DT_TAB.push(new Int32Array(32))
  for (let d = 0; d <= 3; d++) {
    for (let i = 0; i < 32; i++) {
      const v = DT_BASE[d * 32 + i] * 64
      DT_TAB[d][i] = v
      DT_TAB[d + 4][i] = -v
    }
  }
  // vibrato del LFO: multiplicador de frecuencia por paso (32 pasos, forma senoidal)
  for (let p = 0; p < 8; p++) {
    const t = new Float64Array(32)
    for (let s = 0; s < 32; s++) {
      const w = Math.sin((2 * Math.PI * (s + 0.5)) / 32)
      t[s] = Math.pow(2, (PMS_CENTS[p] * w) / 1200) - 1
    }
    PM_DELTA.push(t)
  }
}
initTables()

// ── operador ────────────────────────────────────────────────────────────────
function opCalc(phase: number, env: number, pm: number): number {
  const p = (env << 3) + SIN_TAB[((((phase & ~0xffff) + (pm << 15)) >> FREQ_SH) & SIN_MASK)]
  return p >= TL_TAB_LEN ? 0 : TL_TAB[p]
}

function opCalc1(phase: number, env: number, pm: number): number {
  const i = (phase & ~0xffff) + pm
  const p = (env << 3) + SIN_TAB[(i >> FREQ_SH) & SIN_MASK]
  return p >= TL_TAB_LEN ? 0 : TL_TAB[p]
}

export class YM2612 {
  readonly clock: number
  /** tasa nativa de muestreo del chip (clock / 144) */
  readonly rate: number
  /** última muestra estéreo generada, normalizada a ~±1 */
  outL = 0
  outR = 0
  /** última salida de cada canal (±8191), útil para medidores */
  readonly chanOut = new Int32Array(6)

  // globales
  private egDiv = 0
  private egCnt = 0
  private lfoOn = false
  private lfoPeriod = 108
  private lfoTimer = 0
  private lfoCnt = 0
  private lfoAm = 126
  private lfoPmStep = 0
  private dacOn = false
  private dacOut = 0
  private fnHi = 0
  /** bits que pierde cada portadora al salir: 5 con el DAC de 9 bits, 0 en la suma ideal */
  private outShift = 0
  /**
   * Con el DAC de 9 bits, el escalón del cruce por cero ("ladder effect") del YM2612 discreto.
   * Sin él queda solo la cuantización, como en el YM3438 de las consolas tardías.
   */
  ladder = true

  // por canal
  private readonly alg = new Uint8Array(6)
  private readonly fb = new Uint8Array(6)
  private readonly amsShift = new Uint8Array(6).fill(8)
  private readonly pms = new Uint8Array(6)
  private readonly panL = new Uint8Array(6).fill(1)
  private readonly panR = new Uint8Array(6).fill(1)
  private readonly fc = new Int32Array(6)
  private readonly kc = new Int32Array(6)
  private readonly op1Out0 = new Int32Array(6)
  private readonly op1Out1 = new Int32Array(6)
  private readonly memVal = new Int32Array(6)

  // por slot (24, orden de registro S1 S3 S2 S4)
  private readonly phase = new Int32Array(24)
  private readonly incr = new Int32Array(24)
  private readonly dt = new Uint8Array(24)
  private readonly mul = new Uint8Array(24).fill(1)
  private readonly ksrSh = new Uint8Array(24).fill(3)
  private readonly tl = new Int32Array(24)
  private readonly ar = new Uint8Array(24)
  private readonly d1r = new Uint8Array(24)
  private readonly d2r = new Uint8Array(24)
  private readonly rr = new Uint8Array(24).fill(34)
  private readonly sl = new Int32Array(24)
  private readonly amMask = new Int32Array(24)
  private readonly state = new Uint8Array(24)
  private readonly volume = new Int32Array(24).fill(MAX_ATT_INDEX)
  private readonly key = new Uint8Array(24)
  private readonly ksr = new Int8Array(24).fill(-1)
  private readonly shAr = new Uint8Array(24)
  private readonly selAr = new Uint8Array(24)
  private readonly shD1 = new Uint8Array(24)
  private readonly selD1 = new Uint8Array(24)
  private readonly shD2 = new Uint8Array(24)
  private readonly selD2 = new Uint8Array(24)
  private readonly shRr = new Uint8Array(24)
  private readonly selRr = new Uint8Array(24)

  constructor(clock = YM2612_CLOCK_NTSC) {
    this.clock = clock
    this.rate = clock / YM2612_DIVIDER
    this.reset()
  }

  /**
   * Etapa de salida. `true` = YM2612 discreto (Mega Drive Model 1): cada portadora se trunca a
   * 9 bits y el DAC, que reparte el tiempo entre los seis canales, añade un escalón en el cruce
   * por cero: un canal aporta su valor un cuarto del tiempo y solo su signo el resto. Es lo que
   * hace que las colas y las notas suaves suenen más fuertes y granuladas que en un YM3438.
   * `false` = suma limpia a 14 bits.
   */
  get discrete(): boolean {
    return this.outShift !== 0
  }
  set discrete(on: boolean) {
    this.outShift = on ? 5 : 0
  }

  reset(): void {
    this.egDiv = 0
    this.egCnt = 0
    this.lfoOn = false
    this.lfoPeriod = 108
    this.lfoTimer = 0
    this.lfoCnt = 0
    this.lfoAm = 126
    this.lfoPmStep = 0
    this.dacOn = false
    this.dacOut = 0
    this.fnHi = 0
    this.outL = 0
    this.outR = 0
    this.chanOut.fill(0)
    this.alg.fill(0)
    this.fb.fill(0)
    this.amsShift.fill(8)
    this.pms.fill(0)
    this.panL.fill(1)
    this.panR.fill(1)
    this.fc.fill(0)
    this.kc.fill(0)
    this.op1Out0.fill(0)
    this.op1Out1.fill(0)
    this.memVal.fill(0)
    this.phase.fill(0)
    this.incr.fill(0)
    this.dt.fill(0)
    this.mul.fill(1)
    this.ksrSh.fill(3)
    this.tl.fill(0)
    this.ar.fill(0)
    this.d1r.fill(0)
    this.d2r.fill(0)
    this.rr.fill(34)
    this.sl.fill(0)
    this.amMask.fill(0)
    this.state.fill(EG_OFF)
    this.volume.fill(MAX_ATT_INDEX)
    this.key.fill(0)
    this.ksr.fill(-1)
    for (let i = 0; i < 24; i++) this.refreshEg(i)
  }

  // ── escritura de registros ────────────────────────────────────────────────
  /** port 0 → canales 1-3 (+ globales) · port 1 → canales 4-6 */
  write(port: number, reg: number, val: number): void {
    reg &= 0xff
    val &= 0xff
    if (reg < 0x30) {
      if (port === 0) this.writeGlobal(reg, val)
      return
    }
    const c = reg & 3
    if (c === 3) return
    const ch = c + (port ? 3 : 0)
    const i = (ch << 2) + ((reg >> 2) & 3)

    switch (reg & 0xf0) {
      case 0x30: {
        this.dt[i] = (val >> 4) & 7
        const m = val & 15
        this.mul[i] = m ? m << 1 : 1
        this.refreshIncr(i)
        break
      }
      case 0x40:
        this.tl[i] = (val & 0x7f) << 3
        break
      case 0x50: {
        this.ksrSh[i] = 3 - (val >> 6)
        const a = val & 31
        this.ar[i] = a ? 32 + (a << 1) : 0
        this.ksr[i] = -1
        this.refreshEg(i)
        break
      }
      case 0x60: {
        this.amMask[i] = val & 0x80 ? -1 : 0
        const d = val & 31
        this.d1r[i] = d ? 32 + (d << 1) : 0
        this.ksr[i] = -1
        this.refreshEg(i)
        break
      }
      case 0x70: {
        const d = val & 31
        this.d2r[i] = d ? 32 + (d << 1) : 0
        this.ksr[i] = -1
        this.refreshEg(i)
        break
      }
      case 0x80:
        this.sl[i] = SL_TABLE[val >> 4]
        this.rr[i] = 34 + ((val & 15) << 2)
        this.ksr[i] = -1
        this.refreshEg(i)
        break
      case 0x90:
        // SSG-EG: no implementado (casi ningún parche lo usa)
        break
      case 0xa0:
        switch (reg & 0x0c) {
          case 0x00:
            this.setFreq(ch, ((this.fnHi & 7) << 8) | val, this.fnHi >> 3)
            break
          case 0x04:
            this.fnHi = val & 0x3f
            break
          default:
            break // modo de 3 frecuencias (CH3 especial): no implementado
        }
        break
      case 0xb0:
        switch (reg & 0x0c) {
          case 0x00: {
            const f = (val >> 3) & 7
            this.fb[ch] = f ? f + 6 : 0
            this.alg[ch] = val & 7
            break
          }
          case 0x04:
            this.panL[ch] = (val >> 7) & 1
            this.panR[ch] = (val >> 6) & 1
            this.amsShift[ch] = AMS_SHIFT[(val >> 4) & 3]
            this.pms[ch] = val & 7
            for (let k = 0; k < 4; k++) this.refreshIncr((ch << 2) + k)
            break
          default:
            break
        }
        break
      default:
        break
    }
  }

  private writeGlobal(reg: number, val: number): void {
    switch (reg) {
      case 0x22:
        if (val & 8) {
          this.lfoOn = true
          this.lfoPeriod = LFO_SAMPLES_PER_STEP[val & 7]
        } else {
          this.lfoOn = false
          this.lfoTimer = 0
          this.lfoCnt = 0
          this.lfoAm = 126
          this.setPmStep(0)
        }
        break
      case 0x28: {
        let ch = val & 7
        if ((ch & 3) === 3) return
        if (ch & 4) ch = (ch & 3) + 3
        const base = ch << 2
        // bit 4 → op1 · bit 5 → op2 · bit 6 → op3 · bit 7 → op4
        this.setKey(base + K_OP1, val & 0x10)
        this.setKey(base + K_OP2, val & 0x20)
        this.setKey(base + K_OP3, val & 0x40)
        this.setKey(base + K_OP4, val & 0x80)
        break
      }
      case 0x2a:
        this.dacOut = (val - 0x80) << 6
        break
      case 0x2b:
        this.dacOn = (val & 0x80) !== 0
        break
      default:
        break // timers / modo CH3 → ignorados
    }
  }

  private setKey(i: number, on: number): void {
    if (on) {
      if (!this.key[i]) {
        this.phase[i] = 0
        if (this.ar[i] + this.ksr[i] < 94) {
          this.state[i] =
            this.volume[i] <= MIN_ATT_INDEX ? (this.sl[i] === MIN_ATT_INDEX ? EG_SUS : EG_DEC) : EG_ATT
        } else {
          this.volume[i] = MIN_ATT_INDEX
          this.state[i] = this.sl[i] === MIN_ATT_INDEX ? EG_SUS : EG_DEC
        }
      }
      this.key[i] = 1
    } else if (this.key[i]) {
      this.key[i] = 0
      if (this.state[i] > EG_REL) this.state[i] = EG_REL
    }
  }

  private setFreq(ch: number, fn: number, blk: number): void {
    this.kc[ch] = (blk << 2) | FN_KEY[fn >> 7]
    this.fc[ch] = (fn * 4096) >> (7 - blk)
    for (let k = 0; k < 4; k++) {
      const i = (ch << 2) + k
      this.ksr[i] = -1
      this.refreshIncr(i)
      this.refreshEg(i)
    }
  }

  private refreshIncr(i: number): void {
    const ch = i >> 2
    let fc = this.fc[ch]
    const pms = this.pms[ch]
    if (pms) fc += Math.trunc(fc * PM_DELTA[pms][this.lfoPmStep])
    this.incr[i] = ((fc + DT_TAB[this.dt[i]][this.kc[ch]]) * this.mul[i]) >> 1
  }

  private refreshEg(i: number): void {
    const ch = i >> 2
    const ksr = this.kc[ch] >> this.ksrSh[i]
    if (this.ksr[i] === ksr) return
    this.ksr[i] = ksr
    const a = this.ar[i] + ksr
    if (a < 32 + 62) {
      this.shAr[i] = EG_RATE_SHIFT[a]
      this.selAr[i] = EG_RATE_SELECT[a]
    } else {
      this.shAr[i] = 0
      this.selAr[i] = 17 * 8
    }
    this.shD1[i] = EG_RATE_SHIFT[this.d1r[i] + ksr]
    this.shD2[i] = EG_RATE_SHIFT[this.d2r[i] + ksr]
    this.shRr[i] = EG_RATE_SHIFT[this.rr[i] + ksr]
    this.selD1[i] = EG_RATE_SELECT[this.d1r[i] + ksr]
    this.selD2[i] = EG_RATE_SELECT[this.d2r[i] + ksr]
    this.selRr[i] = EG_RATE_SELECT[this.rr[i] + ksr]
  }

  private setPmStep(step: number): void {
    if (step === this.lfoPmStep) return
    this.lfoPmStep = step
    for (let ch = 0; ch < 6; ch++) {
      if (this.pms[ch]) for (let k = 0; k < 4; k++) this.refreshIncr((ch << 2) + k)
    }
  }

  // ── envolvente ────────────────────────────────────────────────────────────
  private advanceEg(): void {
    const cnt = this.egCnt
    const volume = this.volume
    const state = this.state
    for (let i = 0; i < 24; i++) {
      switch (state[i]) {
        case EG_ATT: {
          const sh = this.shAr[i]
          if ((cnt & ((1 << sh) - 1)) === 0) {
            const inc = EG_INC[this.selAr[i] + ((cnt >> sh) & 7)]
            volume[i] += (~volume[i] * inc) >> 4
            if (volume[i] <= MIN_ATT_INDEX) {
              volume[i] = MIN_ATT_INDEX
              state[i] = EG_DEC
            }
          }
          break
        }
        case EG_DEC: {
          const sh = this.shD1[i]
          if ((cnt & ((1 << sh) - 1)) === 0) {
            volume[i] += EG_INC[this.selD1[i] + ((cnt >> sh) & 7)]
            if (volume[i] >= this.sl[i]) state[i] = EG_SUS
          }
          break
        }
        case EG_SUS: {
          const sh = this.shD2[i]
          if ((cnt & ((1 << sh) - 1)) === 0) {
            volume[i] += EG_INC[this.selD2[i] + ((cnt >> sh) & 7)]
            if (volume[i] >= MAX_ATT_INDEX) volume[i] = MAX_ATT_INDEX
          }
          break
        }
        case EG_REL: {
          const sh = this.shRr[i]
          if ((cnt & ((1 << sh) - 1)) === 0) {
            volume[i] += EG_INC[this.selRr[i] + ((cnt >> sh) & 7)]
            if (volume[i] >= MAX_ATT_INDEX) {
              volume[i] = MAX_ATT_INDEX
              state[i] = EG_OFF
            }
          }
          break
        }
        default:
          break
      }
    }
  }

  // ── un canal FM, una muestra ──────────────────────────────────────────────
  private chanCalc(ch: number): number {
    const b = ch << 2
    const volume = this.volume
    const state = this.state
    // canal completamente en silencio: nada que calcular
    if (
      state[b] === EG_OFF &&
      state[b + 1] === EG_OFF &&
      state[b + 2] === EG_OFF &&
      state[b + 3] === EG_OFF
    ) {
      this.op1Out0[ch] = 0
      this.op1Out1[ch] = 0
      this.memVal[ch] = 0
      return 0
    }

    const tl = this.tl
    const amMask = this.amMask
    const phase = this.phase
    const am = this.lfoAm >> this.amsShift[ch]
    const algo = this.alg[ch]
    // las portadoras pierden aquí los bits que no llegan al DAC (0 en la salida ideal)
    const sh = this.outShift

    const eg1 = volume[b + K_OP1] + tl[b + K_OP1] + (am & amMask[b + K_OP1])
    const eg3 = volume[b + K_OP3] + tl[b + K_OP3] + (am & amMask[b + K_OP3])
    const eg2 = volume[b + K_OP2] + tl[b + K_OP2] + (am & amMask[b + K_OP2])
    const eg4 = volume[b + K_OP4] + tl[b + K_OP4] + (am & amMask[b + K_OP4])

    let c1 = 0
    let c2 = 0
    let m2 = 0
    let mem = 0
    let out = 0

    // el operador 1 usa la suma de sus dos salidas anteriores como realimentación
    const fbIn = this.op1Out0[ch] + this.op1Out1[ch]
    this.op1Out0[ch] = this.op1Out1[ch]
    const o1 = this.op1Out0[ch]
    const memv = this.memVal[ch]

    switch (algo) {
      case 0:
        m2 = memv
        c1 = o1
        break
      case 1:
        mem = o1
        m2 = memv
        break
      case 2:
        c2 = o1
        m2 = memv
        break
      case 3:
        c1 = o1
        c2 = memv
        break
      case 4:
        c1 = o1
        break
      case 5:
        mem = c1 = c2 = o1
        m2 = memv
        break
      case 6:
        c1 = o1
        break
      default:
        out += o1 >> sh
        break
    }

    // operador 1 (con realimentación)
    let o1new = 0
    if (eg1 < ENV_QUIET) {
      const f = this.fb[ch]
      o1new = opCalc1(phase[b + K_OP1], eg1, f ? fbIn << f : 0)
    }
    this.op1Out1[ch] = o1new

    // operador 3 (M2)
    if (eg3 < ENV_QUIET) {
      const v = opCalc(phase[b + K_OP3], eg3, m2)
      if (algo < 5) c2 += v
      else out += v >> sh
    }
    // operador 2 (C1)
    if (eg2 < ENV_QUIET) {
      const v = opCalc(phase[b + K_OP2], eg2, c1)
      if (algo < 4) mem += v
      else out += v >> sh
    }
    // operador 4 (C2)
    if (eg4 < ENV_QUIET) out += opCalc(phase[b + K_OP4], eg4, c2) >> sh

    this.memVal[ch] = mem

    // avance de fase DESPUÉS de calcular la salida
    const incr = this.incr
    phase[b] = (phase[b] + incr[b]) | 0
    phase[b + 1] = (phase[b + 1] + incr[b + 1]) | 0
    phase[b + 2] = (phase[b + 2] + incr[b + 2]) | 0
    phase[b + 3] = (phase[b + 3] + incr[b + 3]) | 0

    return out
  }

  /** Genera UNA muestra a la tasa nativa del chip (clock/144). */
  tick(): void {
    // LFO
    if (this.lfoOn) {
      if (++this.lfoTimer >= this.lfoPeriod) {
        this.lfoTimer = 0
        this.lfoCnt = (this.lfoCnt + 1) & 127
        const c = this.lfoCnt
        this.lfoAm = c < 64 ? (c ^ 63) << 1 : (c & 63) << 1
        this.setPmStep(c >> 2)
      }
    }
    // envolvente: un paso cada 3 muestras
    if (++this.egDiv === 3) {
      this.egDiv = 0
      this.egCnt = (this.egCnt + 1) | 0
      this.advanceEg()
    }

    let l = 0
    let r = 0
    if (this.outShift) {
      // YM2612 discreto: 9 bits por canal. En unidades de 1 LSB, un canal vale q + 4 si es
      // positivo y q − 3 si es negativo (su valor un ciclo de cada cuatro y su signo los otros
      // tres); en el lado donde está apagado solo queda el signo: ±4.
      for (let ch = 0; ch < 6; ch++) {
        let q: number
        if (ch === 5 && this.dacOn) q = this.dacOut >> 5
        else q = this.chanCalc(ch)
        if (q > 255) q = 255
        else if (q < -256) q = -256
        this.chanOut[ch] = q << 5
        if (!this.ladder) {
          if (this.panL[ch]) l += q
          if (this.panR[ch]) r += q
        } else if (q >= 0) {
          l += this.panL[ch] ? q + 4 : 4
          r += this.panR[ch] ? q + 4 : 4
        } else {
          l += this.panL[ch] ? q - 3 : -4
          r += this.panR[ch] ? q - 3 : -4
        }
      }
      this.outL = l / 1024
      this.outR = r / 1024
      return
    }
    for (let ch = 0; ch < 6; ch++) {
      let o: number
      if (ch === 5 && this.dacOn) o = this.dacOut
      else o = this.chanCalc(ch)
      if (o > 8191) o = 8191
      else if (o < -8192) o = -8192
      this.chanOut[ch] = o
      if (this.panL[ch]) l += o
      if (this.panR[ch]) r += o
    }
    this.outL = l / 32768
    this.outR = r / 32768
  }

  /** true si algún slot sigue sonando (para saltar trabajo en silencio) */
  isActive(): boolean {
    for (let i = 0; i < 24; i++) if (this.state[i] !== EG_OFF) return true
    return this.dacOn
  }
}
