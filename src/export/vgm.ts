// ── Exportador VGM / VGZ ────────────────────────────────────────────────────
//
// El VGM se genera ejecutando el MISMO driver que suena en la app y volcando
// cada escritura de registro con su marca de tiempo (44100 Hz = base de VGM).
// Resultado: el archivo lleva exactamente lo que suena en la previsualización,
// para cualquier reproductor VGM (VGMPlay, Deflemask, xgmtool de SGDK) o consola.
// Está contrastado con un reproductor independiente (libgme): `npm run test:ref`.
import { gzipSync } from 'fflate'
import { SN76489_CLOCK_NTSC } from '../core/sn76489'
import { YM2612_CLOCK_NTSC } from '../core/ym2612'
import { Synth, type WriteKind } from '../engine/synth'
import type { Song } from '../music/song'

export const VGM_RATE = 44100
const HEADER_SIZE = 0x100

export interface VgmOptions {
  /** segundos de cola al final (liberación de notas) */
  tail?: number
  /** título / autor / sistema para la etiqueta GD3 */
  title?: string
  author?: string
  game?: string
}

export interface CapturedWrites {
  /** [t, kind, a, b] aplanado */
  events: number[]
  /** [t, sonido, ganancia] aplanado: golpes de batería PCM */
  drums: number[]
  endSample: number
  loopSample: number
}

/** Ejecuta el driver sin generar audio y captura todas las escrituras. */
export function captureWrites(song: Song, tail = 0.6): CapturedWrites {
  const synth = new Synth(VGM_RATE, song)
  const events: number[] = []
  const drums: number[] = []
  synth.log = (t: number, kind: WriteKind, a: number, b: number) => {
    events.push(t, kind, a, b)
  }
  synth.onDrum = (t, drum, gain) => {
    drums.push(t, drum, gain)
  }
  // las escrituras de init() ya ocurrieron en el constructor (con log nulo):
  // las reponemos a t=0 relanzando reset() con el logger activo.
  synth.reset()
  synth.stopAtEnd = true
  let loopSample = -1
  const ls = song.loopStart
  synth.onOrder = (order, t) => {
    if (ls >= 0 && order === ls && loopSample < 0) loopSample = t
  }
  synth.play(0, 0)
  const maxSamples = VGM_RATE * 60 * 30
  while (synth.playing && synth.time < maxSamples) synth.advanceOnly(2048)
  const endOfSong = synth.time
  synth.advanceOnly(Math.round(tail * VGM_RATE))
  // apaga todo para que el VGM termine en silencio
  synth.panic()
  return { events, drums, endSample: synth.time, loopSample: ls >= 0 && loopSample >= 0 ? Math.min(loopSample, endOfSong) : -1 }
}

class ByteWriter {
  private buf = new Uint8Array(1 << 16)
  len = 0
  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length
    while (cap < this.len + n) cap *= 2
    const nb = new Uint8Array(cap)
    nb.set(this.buf.subarray(0, this.len))
    this.buf = nb
  }
  u8(v: number) {
    this.ensure(1)
    this.buf[this.len++] = v & 0xff
  }
  u16(v: number) {
    this.u8(v)
    this.u8(v >> 8)
  }
  u32(v: number) {
    this.u16(v)
    this.u16(v >>> 16)
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

function writeWait(w: ByteWriter, n: number) {
  while (n > 0) {
    if (n === 735) {
      w.u8(0x62)
      return
    }
    if (n === 882) {
      w.u8(0x63)
      return
    }
    if (n <= 16) {
      w.u8(0x70 + (n - 1))
      return
    }
    const c = Math.min(n, 65535)
    // evita dejar un resto 735/882 sin atajo: no importa, correcto igualmente
    w.u8(0x61)
    w.u16(c)
    n -= c
  }
}

function utf16(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out.push(c & 0xff, c >> 8)
  }
  out.push(0, 0)
  return out
}

export function buildVgmFromWrites(cap: CapturedWrites, opts: VgmOptions = {}): Uint8Array {
  const data = new ByteWriter()
  let cursor = 0
  let loopByte = -1
  const { events, loopSample, endSample } = cap
  let loopPending = loopSample >= 0

  const markLoopIfDue = (t: number) => {
    if (loopPending && t >= loopSample) {
      writeWait(data, loopSample - cursor)
      cursor = loopSample
      loopByte = data.len
      loopPending = false
    }
  }

  for (let i = 0; i < events.length; i += 4) {
    const t = events[i]
    markLoopIfDue(t)
    if (t > cursor) {
      writeWait(data, t - cursor)
      cursor = t
    }
    const kind = events[i + 1]
    const a = events[i + 2]
    const b = events[i + 3]
    if (kind === 2) {
      data.u8(0x50)
      data.u8(a)
    } else {
      data.u8(kind === 0 ? 0x52 : 0x53)
      data.u8(a)
      data.u8(b)
    }
  }
  markLoopIfDue(endSample)
  if (endSample > cursor) {
    writeWait(data, endSample - cursor)
    cursor = endSample
  }
  data.u8(0x66)
  const body = data.bytes()

  // ── GD3 ──
  const fields = [
    opts.title ?? 'TZOOTZ JAM',
    '',
    opts.game ?? 'TZOOTZ RESEARCH CHIP CONSOLE',
    '',
    'Sega Mega Drive / Genesis',
    '',
    opts.author ?? 'TZOOTZ RESEARCH',
    '',
    new Date().getFullYear().toString(),
    'TZ MegaDrive Studio',
    'YM2612 + SN76489',
  ]
  const g: number[] = []
  for (const f of fields) g.push(...utf16(f))
  const gd3 = new ByteWriter()
  for (const c of [0x47, 0x64, 0x33, 0x20]) gd3.u8(c) // "Gd3 "
  gd3.u32(0x00000100)
  gd3.u32(g.length)
  for (const b of g) gd3.u8(b)
  const gd3Bytes = gd3.bytes()

  // ── cabecera (v1.71, 0x100 bytes) ──
  const total = HEADER_SIZE + body.length + gd3Bytes.length
  const h = new ByteWriter()
  for (const c of [0x56, 0x67, 0x6d, 0x20]) h.u8(c) // "Vgm "
  h.u32(total - 4) // 0x04 EOF offset
  h.u32(0x00000171) // 0x08 versión
  h.u32(SN76489_CLOCK_NTSC) // 0x0C
  h.u32(0) // 0x10 YM2413
  h.u32(HEADER_SIZE + body.length - 0x14) // 0x14 GD3 offset
  h.u32(cursor) // 0x18 total samples
  h.u32(loopByte >= 0 ? HEADER_SIZE + loopByte - 0x1c : 0) // 0x1C loop offset
  h.u32(loopByte >= 0 ? cursor - loopSample : 0) // 0x20 loop samples
  h.u32(60) // 0x24 rate
  h.u16(0x0009) // 0x28 SN feedback
  h.u8(16) // 0x2A SN shift width
  h.u8(0) // 0x2B SN flags
  h.u32(YM2612_CLOCK_NTSC) // 0x2C
  h.u32(0) // 0x30 YM2151
  h.u32(HEADER_SIZE - 0x34) // 0x34 data offset
  while (h.len < HEADER_SIZE) h.u8(0)

  const out = new Uint8Array(total)
  out.set(h.bytes(), 0)
  out.set(body, HEADER_SIZE)
  out.set(gd3Bytes, HEADER_SIZE + body.length)
  return out
}

export function buildVgm(song: Song, opts: VgmOptions = {}): Uint8Array {
  const cap = captureWrites(song, opts.tail ?? 0.6)
  return buildVgmFromWrites(cap, { title: song.title, author: song.author, ...opts })
}

export function buildVgz(song: Song, opts: VgmOptions = {}): Uint8Array {
  return gzipSync(buildVgm(song, opts), { level: 9 })
}
