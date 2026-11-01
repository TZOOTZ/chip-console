// ── Lector/reproductor VGM mínimo (YM2612 + SN76489) ────────────────────────
// Sirve para verificar lo exportado y para previsualizar archivos .vgm/.vgz.
import { gunzipSync } from 'fflate'
import { ChipConsole } from '../core/mixer'

export interface VgmInfo {
  version: number
  totalSamples: number
  loopSamples: number
  loopOffset: number
  dataOffset: number
  snClock: number
  ymClock: number
  gd3: string[]
}

const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

export function unpackVgm(bytes: Uint8Array): Uint8Array {
  // .vgz = gzip
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes)
  return bytes
}

export function parseVgmHeader(raw: Uint8Array): VgmInfo {
  const b = unpackVgm(raw)
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'Vgm ') throw new Error('No es un archivo VGM')
  const version = u32(b, 0x08)
  let dataOffset = 0x40
  if (version >= 0x150) {
    const rel = u32(b, 0x34)
    if (rel) dataOffset = 0x34 + rel
  }
  const gd3Rel = u32(b, 0x14)
  const gd3: string[] = []
  if (gd3Rel) {
    const p = 0x14 + gd3Rel
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) === 'Gd3 ') {
      const len = u32(b, p + 8)
      let cur = ''
      for (let i = p + 12; i < p + 12 + len; i += 2) {
        const c = b[i] | (b[i + 1] << 8)
        if (c === 0) {
          gd3.push(cur)
          cur = ''
        } else cur += String.fromCharCode(c)
      }
    }
  }
  return {
    version,
    totalSamples: u32(b, 0x18),
    loopSamples: u32(b, 0x20),
    loopOffset: u32(b, 0x1c),
    dataOffset,
    snClock: u32(b, 0x0c) & 0x3fffffff,
    ymClock: version >= 0x110 ? u32(b, 0x2c) & 0x3fffffff : 0,
    gd3,
  }
}

/** Reproduce un VGM a `sampleRate` (usar 44100 para identidad exacta con el driver). */
export function renderVgm(raw: Uint8Array, sampleRate = 44100, maxSeconds = 600): { left: Float32Array; right: Float32Array } {
  const b = unpackVgm(raw)
  const info = parseVgmHeader(b)
  const con = new ChipConsole({
    sampleRate,
    ymClock: info.ymClock || undefined,
    psgClock: info.snClock || undefined,
  })
  const maxOut = Math.min(Math.round(maxSeconds * sampleRate), Math.round((info.totalSamples / 44100) * sampleRate) + sampleRate)
  const left = new Float32Array(maxOut)
  const right = new Float32Array(maxOut)
  let out = 0
  // posición en muestras VGM (44100) → muestras de salida
  let vgmPos = 0
  const emit = (vgmSamples: number) => {
    const target = Math.min(maxOut, Math.round(((vgmPos + vgmSamples) * sampleRate) / 44100))
    while (out < target) {
      con.renderSample()
      left[out] = con.l
      right[out] = con.r
      out++
    }
    vgmPos += vgmSamples
  }

  let p = info.dataOffset
  loop: while (p < b.length) {
    const c = b[p]
    switch (c) {
      case 0x50:
        con.psg.write(b[p + 1])
        p += 2
        break
      case 0x52:
        con.ym.write(0, b[p + 1], b[p + 2])
        p += 3
        break
      case 0x53:
        con.ym.write(1, b[p + 1], b[p + 2])
        p += 3
        break
      case 0x61:
        emit(b[p + 1] | (b[p + 2] << 8))
        p += 3
        break
      case 0x62:
        emit(735)
        p += 1
        break
      case 0x63:
        emit(882)
        p += 1
        break
      case 0x66:
        break loop
      case 0x67: {
        // bloque de datos: 0x67 0x66 tt ssssssss
        const size = u32(b, p + 3)
        p += 7 + size
        break
      }
      default:
        if (c >= 0x70 && c <= 0x7f) {
          emit((c & 15) + 1)
          p += 1
        } else if (c >= 0x80 && c <= 0x8f) {
          // YM2612 DAC desde el banco de datos: no generado por este exportador
          emit(c & 15)
          p += 1
        } else if (c >= 0x30 && c <= 0x3f) p += 2
        else if (c >= 0x40 && c <= 0x4e) p += 3
        else if (c >= 0x51 && c <= 0x5f) p += 3
        else if (c >= 0xa0 && c <= 0xbf) p += 3
        else if (c >= 0xc0 && c <= 0xdf) p += 4
        else if (c >= 0xe0 && c <= 0xff) p += 5
        else p += 1
        break
    }
  }
  return { left: left.subarray(0, out), right: right.subarray(0, out) }
}
