// ── Muestras reales: de un WAV a un sonido del kit ──────────────────────────
//
// Un WAV (cualquier frecuencia, 8/16/24/32 bits o float, mono o estéreo) pasa a lo que
// cabe en el cartucho: mono, recortado al golpe, con su fundido, a la frecuencia del banco y a 8 bits.
// La subida de tono es la que ahorra bytes: una muestra una octava más aguda dura la mitad.
import { toBase64 } from '../engine/drums'
import type { DrumVoice } from '../music/song'

export interface Wav {
  rate: number
  channels: number
  /** la mezcla a mono, -1..1 */
  samples: Float32Array
}

const tag = (dv: DataView, o: number): string => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))

/** lee un WAV (PCM de 8, 16, 24 o 32 bits, o float de 32; también WAVE_FORMAT_EXTENSIBLE) */
export function leerWav(bytes: Uint8Array): Wav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12 || tag(dv, 0) !== 'RIFF' || tag(dv, 8) !== 'WAVE') throw new Error('No es un WAV')
  let fmt = 0
  let channels = 1
  let rate = 44100
  let bits = 16
  let dataAt = -1
  let dataLen = 0
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(dv, o)
    const size = dv.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = dv.getUint16(o + 8, true)
      channels = dv.getUint16(o + 10, true)
      rate = dv.getUint32(o + 12, true)
      bits = dv.getUint16(o + 22, true)
      // extensible: el formato real son los dos primeros bytes del GUID
      if (fmt === 0xfffe && size >= 40) fmt = dv.getUint16(o + 8 + 24, true)
    } else if (id === 'data') {
      dataAt = o + 8
      dataLen = Math.min(size, bytes.length - dataAt)
      break
    }
    o += 8 + size + (size & 1)
  }
  if (dataAt < 0) throw new Error('El WAV no tiene datos')
  if (fmt !== 1 && fmt !== 3) throw new Error('Formato de WAV no soportado: ' + fmt)
  const bps = bits >> 3
  const frames = Math.floor(dataLen / (bps * channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const p = dataAt + (i * channels + c) * bps
      let x: number
      if (fmt === 3) x = bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true)
      else if (bits === 8) x = (dv.getUint8(p) - 128) / 128
      else if (bits === 16) x = dv.getInt16(p, true) / 32768
      else if (bits === 24) x = ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) | 0) / 8388608
      else x = dv.getInt32(p, true) / 2147483648
      sum += x
    }
    out[i] = sum / channels
  }
  return { rate, channels, samples: out }
}

export interface OpcionesMuestra {
  /** frecuencia del banco (Hz): 11025 por defecto */
  rate?: number
  /** duración (ms): como máximo 80 por defecto; en un bucle, exactamente esa */
  ms?: number
  /** semitonos que se sube (o baja) la muestra, con decimales: más agudo = más corto = menos bytes */
  pitch?: number
  /** fundido de salida (ms): 6 por defecto (no cuenta en un bucle) */
  fade?: number
  /** un bucle: dura exactamente `ms`, sin quitar silencio y con el final fundido con el principio */
  loop?: boolean
  /** bucle: desde dónde se toma, en ms de la muestra ya subida de tono */
  desde?: number
  /** bucle: cuánto se funden el final y el principio (ms): 12 por defecto */
  xfade?: number
}

export interface MuestraPreparada {
  pcm: Uint8Array
  rate: number
  ms: number
  bytes: number
}

/** n muestras de `x` desde `from` (en muestras de entrada), cada salida promedia su tramo de entrada */
function remuestrear(x: ArrayLike<number>, from: number, ratio: number, n: number): Float32Array {
  const y = new Float32Array(Math.max(1, n))
  for (let i = 0; i < y.length; i++) {
    const a = from + i * ratio
    const b = Math.min(x.length, from + (i + 1) * ratio)
    const k0 = Math.floor(a)
    const k1 = Math.max(k0 + 1, Math.ceil(b))
    let s = 0
    let w = 0
    for (let k = Math.max(0, k0); k < k1 && k < x.length; k++) {
      const wk = Math.min(k + 1, b) - Math.max(k, a)
      if (wk > 0) {
        s += x[k] * wk
        w += wk
      }
    }
    y[i] = w > 0 ? s / w : 0
  }
  return y
}

/** del WAV al PCM de 8 bits del banco: sin silencio delante, subida de tono, recorte, fundido, remuestreo y 8 bits */
export function prepararMuestra(wav: Wav, o: OpcionesMuestra = {}): MuestraPreparada {
  const rate = o.rate ?? 11025
  const maxMs = o.ms ?? 80
  let x: Float32Array = wav.samples
  // sin continua
  let mean = 0
  for (const v of x) mean += v
  mean /= Math.max(1, x.length)
  x = x.map((v) => v - mean)
  const ratio = (wav.rate / rate) * Math.pow(2, (o.pitch ?? 0) / 12)
  let y: Float32Array
  if (o.loop) {
    // un bucle exacto: el final se funde con el principio para que el empalme no se oiga
    const len = Math.max(2, Math.round((maxMs / 1000) * rate))
    const xf = Math.max(1, Math.min(len >> 1, Math.round(((o.xfade ?? 12) / 1000) * rate)))
    const from = ((o.desde ?? 0) / 1000) * rate * ratio
    const z = remuestrear(x, from, ratio, len + xf)
    y = z.slice(0, len)
    for (let i = 0; i < xf; i++) y[i] = z[i] * (i / xf) + z[len + i] * (1 - i / xf)
  } else {
    let pk0 = 1e-9
    for (const v of x) pk0 = Math.max(pk0, Math.abs(v))
    let start = 0
    while (start < x.length && Math.abs(x[start]) <= pk0 * 0.01) start++
    const total = Math.floor((x.length - start) / ratio)
    y = remuestrear(x, start, ratio, Math.min(total, Math.round((maxMs / 1000) * rate)))
    const fade = Math.min(y.length >> 1, Math.round(((o.fade ?? 6) / 1000) * rate))
    for (let i = 0; i < fade; i++) y[y.length - 1 - i] *= i / fade
  }
  let pk = 1e-9
  for (const v of y) pk = Math.max(pk, Math.abs(v))
  const pcm = new Uint8Array(y.length)
  for (let i = 0; i < y.length; i++) pcm[i] = Math.max(1, Math.min(255, Math.round((y[i] / pk) * 126) + 128))
  return { pcm, rate, ms: (y.length / rate) * 1000, bytes: y.length }
}

/** la muestra preparada como un sonido del kit (kind `sample`) */
export function vozDeMuestra(name: string, m: MuestraPreparada, gain = 0.9): DrumVoice {
  return { name: name.toUpperCase().slice(0, 12), kind: 'sample', pitch: 0.5, decay: 0.5, tone: 0.5, gain, pcm: toBase64(m.pcm), rate: m.rate }
}
