// ── SN76489 (PSG de la Mega Drive / Master System) ──────────────────────────
//
// 3 canales de onda cuadrada + 1 canal de ruido (LFSR de 16 bits, variante Sega).
// El chip cuenta a clock/16; `tick()` avanza UN paso interno y devuelve la
// salida bipolar mezclada. El remuestreo (promedio por área) lo hace `Console`.

export const SN76489_CLOCK_NTSC = 3_579_545
export const SN76489_DIVIDER = 16

/** atenuación de 2 dB por paso; 15 = apagado */
const VOL = new Float64Array(16)
for (let i = 0; i < 15; i++) VOL[i] = Math.pow(10, (-2 * i) / 20)
VOL[15] = 0

export class SN76489 {
  readonly clock: number
  /** tasa interna de pasos (clock / 16) */
  readonly rate: number

  /** registros de tono (10 bits) */
  readonly tone = new Uint16Array(3)
  /** atenuación 0-15 de cada canal (3 = ruido) */
  readonly att = new Uint8Array(4).fill(15)
  /** control de ruido: bit 2 = ruido blanco, bits 0-1 = tasa */
  noiseCtl = 0

  /** nivel instantáneo por canal (para medidores) */
  readonly chanLevel = new Float32Array(4)

  private readonly counter = new Int32Array(4)
  private readonly pol = new Int8Array(4).fill(1)
  private lfsr = 0x8000
  private latch = 0

  constructor(clock = SN76489_CLOCK_NTSC) {
    this.clock = clock
    this.rate = clock / SN76489_DIVIDER
    this.reset()
  }

  reset(): void {
    this.tone.fill(0)
    this.att.fill(15)
    this.noiseCtl = 0
    this.counter.fill(0)
    this.pol.fill(1)
    this.lfsr = 0x8000
    this.latch = 0
    this.chanLevel.fill(0)
  }

  /** escritura de un byte al puerto del PSG (protocolo latch + dato) */
  write(v: number): void {
    v &= 0xff
    if (v & 0x80) {
      this.latch = (v >> 4) & 7
      const ch = this.latch >> 1
      if (this.latch & 1) this.att[ch] = v & 15
      else if (ch < 3) this.tone[ch] = (this.tone[ch] & 0x3f0) | (v & 0x0f)
      else {
        this.noiseCtl = v & 7
        this.lfsr = 0x8000
      }
    } else {
      const ch = this.latch >> 1
      if (this.latch & 1) this.att[ch] = v & 15
      else if (ch < 3) this.tone[ch] = ((v & 0x3f) << 4) | (this.tone[ch] & 0x0f)
      else {
        this.noiseCtl = v & 7
        this.lfsr = 0x8000
      }
    }
  }

  /** Avanza un paso interno (clock/16). Salida bipolar: un canal a tope = ±0.5. */
  tick(): number {
    let out = 0
    for (let c = 0; c < 3; c++) {
      if (--this.counter[c] <= 0) {
        this.counter[c] = this.tone[c] || 1024
        this.pol[c] = -this.pol[c]
      }
      const v = this.pol[c] * VOL[this.att[c]]
      this.chanLevel[c] = Math.abs(v)
      out += v
    }
    if (--this.counter[3] <= 0) {
      const nf = this.noiseCtl & 3
      this.counter[3] = nf < 3 ? 0x10 << nf : this.tone[2] || 1024
      this.pol[3] = -this.pol[3]
      if (this.pol[3] > 0) {
        // el registro de desplazamiento avanza en el flanco de subida
        const fb = this.noiseCtl & 4 ? parity(this.lfsr & 0x0009) : this.lfsr & 1
        this.lfsr = (this.lfsr >> 1) | (fb << 15)
      }
    }
    const nv = (this.lfsr & 1 ? 1 : -1) * VOL[this.att[3]]
    this.chanLevel[3] = Math.abs(nv)
    out += nv
    return out * 0.5
  }
}

function parity(x: number): number {
  x ^= x >> 8
  x ^= x >> 4
  x ^= x >> 2
  x ^= x >> 1
  return x & 1
}
