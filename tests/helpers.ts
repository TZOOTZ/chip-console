// Utilidades de análisis de audio para los tests (FFT, RMS, pico espectral...)
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** FFT radix-2 in-place (re/im de longitud potencia de 2). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j]
        const ui = im[i + j]
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr
        re[i + j] = ur + vr
        im[i + j] = ui + vi
        re[i + j + len / 2] = ur - vr
        im[i + j + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Espectro de magnitud (ventana Hann, relleno con ceros a `size`). */
export function magnitudeSpectrum(x: ArrayLike<number>, size = 1 << 17): Float64Array {
  const n = Math.min(x.length, size)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  fft(re, im)
  const mag = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i])
  return mag
}

/** Frecuencia del pico espectral principal (interpolación parabólica). */
export function peakFreq(x: ArrayLike<number>, rate: number, minHz = 20, size = 1 << 17): number {
  const mag = magnitudeSpectrum(x, size)
  const lo = Math.max(1, Math.floor((minHz * size) / rate))
  let best = lo
  for (let i = lo; i < mag.length - 1; i++) if (mag[i] > mag[best]) best = i
  const a = Math.log(mag[best - 1] + 1e-12)
  const b = Math.log(mag[best] + 1e-12)
  const c = Math.log(mag[best + 1] + 1e-12)
  const d = a - 2 * b + c
  const off = d !== 0 ? (0.5 * (a - c)) / d : 0
  return ((best + off) * rate) / size
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

export function peak(x: ArrayLike<number>, from = 0, to = x.length): number {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}

/** Centroide espectral (Hz) */
export function spectralCentroid(x: ArrayLike<number>, rate: number, size = 1 << 15): number {
  const mag = magnitudeSpectrum(x, size)
  let num = 0
  let den = 0
  for (let i = 1; i < mag.length; i++) {
    num += i * mag[i]
    den += mag[i]
  }
  return den > 0 ? (num / den) * (rate / size) : 0
}

export const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12))

/** Escribe un WAV mono/estéreo de 16 bits (para inspección manual en tests/out). */
export function writeWav(path: string, rate: number, ...channels: Float32Array[]): void {
  const n = channels[0].length
  const nch = channels.length
  const buf = Buffer.alloc(44 + n * nch * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * nch * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(nch, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * nch * 2, 28)
  buf.writeUInt16LE(nch * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * nch * 2, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]))
      buf.writeInt16LE(Math.round(v * 32767), o)
      o += 2
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
}
