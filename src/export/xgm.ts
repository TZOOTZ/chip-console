// ── Exportador XGM v1.01 (driver XGM de SGDK, NTSC) ─────────────────────────
//
// Mismo origen que el VGM: las escrituras reales del driver. Diferencias:
//  · el tiempo se cuantiza a frames (cada `$00` = un frame). El driver avanza uno
//    por retrazo vertical, y en una Mega Drive NTSC eso son 59,92 por segundo, no
//    60: se cuantiza a ese paso para que el tempo en la consola sea el del tema;
//  · la batería PCM no pasa por el DAC crudo: se emite como muestras de 8 bit
//    con signo y comandos `$5X id` (hasta 4 canales PCM mezclados por el Z80).
//
// Especificación: SGDK/bin/xgm.txt (v1.01). Probado en una máquina emulada
// entera (68000 + Z80 con el driver de SGDK): ver tests/rom.test.ts.
import { renderDrum } from '../engine/drums'
import type { Song } from '../music/song'
import { captureWrites } from './vgm'

/** retrazos verticales por segundo de una Mega Drive NTSC (53 693 175 Hz / 3420 / 262) */
export const XGM_FPS = 59.9227
const FRAME = 44100 / XGM_FPS
/**
 * Frecuencia de muestreo del PCM del driver: 14 kHz (un bucle de 254 ciclos del Z80 por
 * muestra, 14 093 Hz en la consola; xgmtool remuestrea a 14 000).
 */
export const XGM_PCM_RATE = 14000
/** niveles de velocidad disponibles por sonido (XGM no tiene volumen por voz) */
export const LEVELS = [1, 0.62, 0.36]

class Bytes {
  data: number[] = []
  u8(v: number) {
    this.data.push(v & 0xff)
  }
  u16(v: number) {
    this.u8(v)
    this.u8(v >> 8)
  }
  u32(v: number) {
    this.u16(v)
    this.u16(v >>> 16)
  }
  get len() {
    return this.data.length
  }
}

export const levelOf = (gain: number): number => {
  // gain ≈ (vel/15)·(vol/100) → nivel más cercano
  let best = 0
  let bd = 9
  LEVELS.forEach((l, i) => {
    const d = Math.abs(l - Math.min(1, gain))
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

type Cmd = { kind: 'ym0' | 'ym1' | 'key' | 'psg' | 'pcm'; a: number; b: number }

export function buildXgm(song: Song): Uint8Array {
  const cap = captureWrites(song, 0.6)
  const totalFrames = Math.ceil(cap.endSample / FRAME) + 1

  // ── muestras PCM usadas ──
  const sampleIds = new Map<string, number>()
  const samples: Int8Array[] = []
  /** lo que dura de verdad cada muestra, en frames (sin el relleno a 256 bytes) */
  const sampleFrames: number[] = []
  const sampleFor = (drum: number, lvl: number): number => {
    const key = `${drum}:${lvl}`
    let id = sampleIds.get(key)
    if (id) return id
    const v = song.drumKit[drum]
    if (!v || samples.length >= 63) return 0
    const pcm = renderDrum(v, XGM_PCM_RATE)
    sampleFrames.push(Math.ceil((pcm.length / XGM_PCM_RATE) * XGM_FPS))
    const len = Math.ceil(pcm.length / 256) * 256
    const s = new Int8Array(len)
    for (let i = 0; i < pcm.length; i++) s[i] = Math.max(-127, Math.min(127, Math.round(pcm[i] * LEVELS[lvl] * 127)))
    samples.push(s)
    id = samples.length
    sampleIds.set(key, id)
    return id
  }

  // ── agrupa los comandos por frame conservando el orden ──
  const frames: Cmd[][] = Array.from({ length: totalFrames }, () => [])
  const frameOf = (t: number): number => Math.min(totalFrames - 1, Math.floor(t / FRAME))
  const ev = cap.events
  for (let i = 0; i < ev.length; i += 4) {
    const t = ev[i]
    const kind = ev[i + 1]
    const a = ev[i + 2]
    const b = ev[i + 3]
    const f = frames[frameOf(t)]
    if (kind === 2) f.push({ kind: 'psg', a, b: 0 })
    else if (kind === 0) {
      if (a === 0x2a || a === 0x2b) continue // DAC crudo: sustituido por PCM
      if (a === 0x28) f.push({ kind: 'key', a: b, b: 0 })
      else f.push({ kind: 'ym0', a, b })
    } else f.push({ kind: 'ym1', a, b })
  }
  // un frame solo conserva la última atenuación de cada canal del PSG: las anteriores no
  // llegarían a oírse y el compilador XGC, que saca primero unas y luego otras según su valor,
  // podría dejar la que no es (una nota colgada si la última era el silencio)
  for (const f of frames) {
    const seen = [false, false, false, false]
    for (let k = f.length - 1; k >= 0; k--) {
      const c = f[k]
      if (c.kind !== 'psg' || (c.a & 0x90) !== 0x90) continue
      const chan = (c.a >> 5) & 3
      if (seen[chan]) f.splice(k, 1)
      else seen[chan] = true
    }
  }
  // disparos de batería → PCM en cuatro canales. Cada golpe va al canal que antes queda libre:
  // el mismo criterio que el DAC de la app (se corta un charles antes que un plato o un timbal)
  const busyUntil = [0, 0, 0, 0]
  for (let i = 0; i < cap.drums.length; i += 3) {
    const id = sampleFor(cap.drums[i + 1], levelOf(cap.drums[i + 2]))
    if (!id) continue
    const at = frameOf(cap.drums[i])
    let ch = 0
    for (let k = 1; k < 4; k++) if (busyUntil[k] < busyUntil[ch]) ch = k
    busyUntil[ch] = at + sampleFrames[id - 1]
    // el PCM se dispara al principio del frame para no retrasar el golpe
    frames[at].unshift({ kind: 'pcm', a: 0x50 | ch, b: id })
  }

  // ── bloque de música ──
  const m = new Bytes()
  const loopFrame = cap.loopSample >= 0 ? frameOf(cap.loopSample) : -1
  let loopAddr = -1
  for (let f = 0; f < totalFrames; f++) {
    if (f === loopFrame) loopAddr = m.len
    const cmds = frames[f]
    let i = 0
    while (i < cmds.length) {
      const c = cmds[i]
      if (c.kind === 'pcm') {
        m.u8(c.a)
        m.u8(c.b)
        i++
        continue
      }
      // junta comandos consecutivos del mismo tipo (máx. 16 por comando)
      let j = i
      while (j < cmds.length && cmds[j].kind === c.kind && j - i < 16) j++
      const n = j - i
      if (c.kind === 'psg') {
        m.u8(0x10 | (n - 1))
        for (let k = i; k < j; k++) m.u8(cmds[k].a)
      } else if (c.kind === 'key') {
        m.u8(0x40 | (n - 1))
        for (let k = i; k < j; k++) m.u8(cmds[k].a)
      } else {
        m.u8((c.kind === 'ym0' ? 0x20 : 0x30) | (n - 1))
        for (let k = i; k < j; k++) {
          m.u8(cmds[k].a)
          m.u8(cmds[k].b)
        }
      }
      i = j
    }
    m.u8(0x00) // fin de frame
  }
  if (loopAddr >= 0) {
    m.u8(0x7e)
    m.u8(loopAddr)
    m.u8(loopAddr >> 8)
    m.u8(loopAddr >> 16)
  } else m.u8(0x7f)

  // ── cabecera + tabla de muestras ──
  const h = new Bytes()
  for (const c of [0x58, 0x47, 0x4d, 0x20]) h.u8(c) // "XGM "
  let addr = 0
  for (let i = 0; i < 63; i++) {
    if (i < samples.length) {
      h.u16(addr / 256)
      h.u16(samples[i].length / 256)
      addr += samples[i].length
    } else {
      h.u16(0xffff)
      h.u16(0x0001)
    }
  }
  h.u16(addr / 256) // SLEN
  h.u8(0x01) // versión
  h.u8(0x00) // flags: NTSC, sin GD3, una pista
  for (const s of samples) for (let i = 0; i < s.length; i++) h.u8(s[i])
  h.u32(m.len)
  const out = new Uint8Array(h.len + m.len)
  out.set(h.data, 0)
  out.set(m.data, h.len)
  return out
}
