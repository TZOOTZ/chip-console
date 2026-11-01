// ── Codificador WAV (PCM 16/24 bits o float 32) ─────────────────────────────
import type { RenderedAudio } from './render'

export type WavFormat = 'pcm16' | 'pcm24' | 'float32'

/** true si ambos canales son idénticos (se puede guardar en mono sin pérdida) */
export function isMono(audio: RenderedAudio): boolean {
  const { left, right } = audio
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

export function encodeWav(audio: RenderedAudio, format: WavFormat = 'pcm16', forceMono = false): Uint8Array {
  const { left, right, sampleRate } = audio
  const n = left.length
  const mono = forceMono || isMono(audio)
  const ch = mono ? 1 : 2
  const bytesPer = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4
  const dataLen = n * ch * bytesPer
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, format === 'float32' ? 3 : 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * ch * bytesPer, true)
  v.setUint16(32, ch * bytesPer, true)
  v.setUint16(34, bytesPer * 8, true)
  str(36, 'data')
  v.setUint32(40, dataLen, true)

  let o = 44
  // dither triangular de ±1 LSB solo para 16 bits
  let seed = 0x1234567
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const put = (x: number) => {
    const c = x > 1 ? 1 : x < -1 ? -1 : x
    if (format === 'float32') {
      v.setFloat32(o, c, true)
      o += 4
    } else if (format === 'pcm24') {
      const s = Math.round(c * 8388607)
      v.setUint8(o, s & 0xff)
      v.setUint8(o + 1, (s >> 8) & 0xff)
      v.setUint8(o + 2, (s >> 16) & 0xff)
      o += 3
    } else {
      const d = (rnd() - rnd()) / 32768
      const s = Math.round(Math.max(-1, Math.min(1, c + d)) * 32767)
      v.setInt16(o, s, true)
      o += 2
    }
  }
  for (let i = 0; i < n; i++) {
    put(left[i])
    if (!mono) put(right[i])
  }
  return new Uint8Array(buf)
}
