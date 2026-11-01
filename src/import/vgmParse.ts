// ── Lector de VGM: del archivo a una línea de tiempo de escrituras de registro ───────
//
// Lee .vgm y .vgz (v1.00 en adelante): el YM2612 y el SN76489 se guardan con su marca de tiempo (muestras a
// 44,1 kHz); los bloques de datos de PCM del YM2612 y los comandos 0x8n («escribe el siguiente byte del banco en el
// DAC y espera n») se convierten en escrituras al registro 0x2A del DAC. Los demás chips se ignoran con un aviso.
import { unpackVgm } from '../export/vgmRead'

export interface YmWrite {
  t: number
  port: number
  reg: number
  val: number
  /** si el byte sale del banco de PCM (comandos 0x8n): su posición en el banco */
  bank?: number
}

export interface VgmTimeline {
  ymClock: number
  snClock: number
  /** muestras (44,1 kHz) que dura */
  total: number
  /** muestra en que empieza el bucle (-1 = sin bucle) */
  loopAt: number
  ym: YmWrite[]
  psg: { t: number; val: number }[]
  /** título, autor y juego de la etiqueta GD3 */
  title: string
  author: string
  warnings: string[]
}

const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

function gd3Fields(b: Uint8Array): string[] {
  const rel = u32(b, 0x14)
  if (!rel) return []
  const p = 0x14 + rel
  if (p + 12 > b.length || String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) !== 'Gd3 ') return []
  const len = u32(b, p + 8)
  const out: string[] = []
  let cur = ''
  for (let i = p + 12; i + 1 < Math.min(b.length, p + 12 + len); i += 2) {
    const c = b[i] | (b[i + 1] << 8)
    if (c === 0) {
      out.push(cur)
      cur = ''
    } else cur += String.fromCharCode(c)
  }
  return out
}

/** bytes que siguen al comando en los que el lector no entiende (los que se saltan) */
function skipLength(c: number): number {
  if (c >= 0x30 && c <= 0x3f) return 1
  if (c >= 0x40 && c <= 0x4f) return c === 0x4f ? 1 : 2
  if (c >= 0x51 && c <= 0x5f) return 2
  if (c >= 0xa0 && c <= 0xbf) return 2
  if (c >= 0xc0 && c <= 0xdf) return 3
  if (c >= 0xe0 && c <= 0xff) return 4
  switch (c) {
    case 0x64:
      return 3
    case 0x68:
      return 11
    case 0x90:
    case 0x91:
    case 0x95:
      return 4
    case 0x92:
      return 5
    case 0x93:
      return 10
    case 0x94:
      return 1
    default:
      return 0
  }
}

const CHIP_NAMES: Record<number, string> = { 0x51: 'YM2413', 0x54: 'YM2151', 0x55: 'YM2203', 0x56: 'YM2608', 0x58: 'YM2610', 0x5a: 'YM3812', 0x5e: 'YMF262' }

export function parseVgm(raw: Uint8Array): VgmTimeline {
  const b = unpackVgm(raw)
  if (b.length < 0x40 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'Vgm ') throw new Error('No es un archivo VGM')
  const version = u32(b, 0x08)
  let p = 0x40
  if (version >= 0x150) {
    const rel = u32(b, 0x34)
    if (rel) p = 0x34 + rel
  }
  const gd3 = gd3Fields(b)
  const out: VgmTimeline = {
    ymClock: version >= 0x110 ? u32(b, 0x2c) & 0x3fffffff : 0,
    snClock: u32(b, 0x0c) & 0x3fffffff,
    total: u32(b, 0x18),
    loopAt: -1,
    ym: [],
    psg: [],
    title: gd3[0] || '',
    author: gd3[6] || '',
    warnings: [],
  }
  const loopOffset = u32(b, 0x1c)
  const loopSamples = u32(b, 0x20)
  const loopByte = loopOffset ? 0x1c + loopOffset : -1
  if (loopByte >= 0 && loopSamples > 0) out.loopAt = Math.max(0, out.total - loopSamples)
  let bank = new Uint8Array(0)
  let pcmPos = 0
  let t = 0
  const unsupported = new Set<string>()
  loop: while (p < b.length) {
    const c = b[p]
    switch (c) {
      case 0x50:
        out.psg.push({ t, val: b[p + 1] })
        p += 2
        break
      case 0x52:
      case 0x53:
        out.ym.push({ t, port: c - 0x52, reg: b[p + 1], val: b[p + 2] })
        p += 3
        break
      case 0x61:
        t += b[p + 1] | (b[p + 2] << 8)
        p += 3
        break
      case 0x62:
        t += 735
        p += 1
        break
      case 0x63:
        t += 882
        p += 1
        break
      case 0x66:
        break loop
      case 0x67: {
        // bloque de datos: 0x67 0x66 tt ssssssss datos (tipo 0 = PCM del YM2612)
        const type = b[p + 2]
        const size = u32(b, p + 3)
        if (type === 0) {
          const next = new Uint8Array(bank.length + size)
          next.set(bank)
          next.set(b.subarray(p + 7, p + 7 + size), bank.length)
          bank = next
        }
        p += 7 + size
        break
      }
      case 0xe0:
        pcmPos = u32(b, p + 1)
        p += 5
        break
      default:
        if (c >= 0x70 && c <= 0x7f) {
          t += (c & 15) + 1
          p += 1
        } else if (c >= 0x80 && c <= 0x8f) {
          // escribe el byte del banco en el DAC y espera n muestras
          out.ym.push({ t, port: 0, reg: 0x2a, val: pcmPos < bank.length ? bank[pcmPos] : 0x80, bank: pcmPos })
          pcmPos++
          t += c & 15
          p += 1
        } else {
          if (CHIP_NAMES[c]) unsupported.add(CHIP_NAMES[c])
          else if (c >= 0x90 && c <= 0x95) unsupported.add('streams de DAC')
          p += 1 + skipLength(c)
        }
        break
    }
  }
  if (!out.total) out.total = t
  if (out.ymClock === 0 && out.ym.length) out.ymClock = 7_670_454
  if (out.snClock === 0 && out.psg.length) out.snClock = 3_579_545
  for (const name of unsupported) out.warnings.push(`El VGM usa ${name}, que la consola de la app no tiene: se ignora`)
  return out
}
