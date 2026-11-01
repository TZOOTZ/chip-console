// ── ROM de Mega Drive: compilador XGC, montaje de la ROM y prueba en una máquina emulada ──
//
// La primera parte corre siempre. La segunda (`npm run test:rom`) necesita dos herramientas
// externas y por eso es opcional:
//   · SGDK 2.11  → su `xgmtool` compila el mismo XGM y el resultado tiene que salir idéntico
//                  byte a byte al de nuestro compilador;
//   · MAME       → arranca la ROM en una Mega Drive emulada entera (68000 + Z80 con el driver
//                  XGM de SGDK), graba lo que suena y lo compara con el render de la app.
// Carpetas: variables TZ_SGDK y TZ_MAME; por defecto ../megadrive-tools/sgdk211 y mame0289.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderSong } from '../src/export/render'
import { ROM_SONG_BASE, buildRom, isPlayerRom, romChecksum, romText } from '../src/export/rom'
import { XGC_PCM_ADVANCE, compileXgc } from '../src/export/xgc'
import { XGM_FPS, XGM_PCM_RATE, buildXgm } from '../src/export/xgm'
import { STYLES, generateSong } from '../src/music/generator'
import { createEmptySong } from '../src/music/presets'
import { timpPitch, type FmOp, type Note, type Song } from '../src/music/song'
import { peakFreq } from './helpers'

const OPT_IN = process.env.TZ_ROM === '1' || (import.meta as { env?: { MODE?: string } }).env?.MODE === 'rom'
const SGDK = resolve(process.env.TZ_SGDK ?? '../megadrive-tools/sgdk211')
const MAME = resolve(process.env.TZ_MAME ?? '../megadrive-tools/mame0289')
const PLAYER = new Uint8Array(readFileSync('rom/player.bin'))
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12))
const off = (): FmOp => ({ mul: 1, dt: 0, tl: 127, rs: 0, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 15, am: 0 })

function tune(notes: Record<string, Note[]>, mod?: (s: Song) => void): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 2
  s.loopStart = -1
  for (const t of s.tracks) {
    t.vol = 100
    t.pan = 'C'
    t.gate = 1
  }
  for (const [id, arr] of Object.entries(notes)) s.patterns[0].notes[id] = arr
  mod?.(s)
  return s
}
const sine = (s: Song): void => {
  s.fmBank[0] = { name: 'SINE', alg: 7, fb: 0, ops: [{ ...off(), tl: 0 }, off(), off(), off()], ams: 0, pms: 0 }
  s.tracks[0].inst = 0
}
const square = (s: Song): void => {
  s.psgBank[0] = { name: 'SQ', vol: 15, a: 0, d: 0, s: 0, r: 0, detune: 0 }
  for (const t of s.tracks) if (t.kind === 'psg') t.inst = 0
}

// ── lector de XGC: recorre los frames tal como lo hace el driver ────────────
interface Frame {
  at: number
  size: number
  cmds: { op: number; args: number[] }[]
}
function readXgc(xgc: Uint8Array): { samples: { addr: number; len: number }[]; sampleBytes: number; frames: Frame[]; loop: number; ended: boolean; musicStart: number } {
  const samples: { addr: number; len: number }[] = []
  for (let i = 0; i < 63; i++) {
    const addr = (xgc[i * 4] | (xgc[i * 4 + 1] << 8)) << 8
    const len = (xgc[i * 4 + 2] | (xgc[i * 4 + 3] << 8)) << 8
    if (addr !== 0xffff00) samples.push({ addr, len })
  }
  const sampleBytes = (xgc[0xfc] | (xgc[0xfd] << 8)) << 8
  const musicStart = 0x100 + sampleBytes + 4
  const musicLen = (xgc[musicStart - 4] | (xgc[musicStart - 3] << 8) | (xgc[musicStart - 2] << 16) | (xgc[musicStart - 1] << 24)) >>> 0
  expect(musicStart + musicLen).toBe(xgc.length)
  const frames: Frame[] = []
  let loop = -1
  let ended = false
  let p = musicStart
  while (p < xgc.length) {
    const size = xgc[p]
    expect(size, `tamaño del frame en ${p}`).toBeGreaterThanOrEqual(1)
    const f: Frame = { at: p - musicStart, size, cmds: [] }
    let q = p + 1
    while (q < p + size) {
      // el código de comando va ×2 (índice de la tabla de saltos del Z80)
      expect(xgc[q] & 1, `comando impar en ${q}`).toBe(0)
      const op = xgc[q] >> 1
      const n = op & 0x0f
      let len: number
      if (op === 0x7e) len = 4
      else if (op === 0x7f || op === 0x7d) len = 1
      else if ((op & 0xf8) === 0x10) len = 2 + (op & 7)
      else if ((op & 0xf8) === 0x18) len = 2 + (op & 3)
      else if ((op & 0xf0) === 0x20 || (op & 0xf0) === 0x30 || (op & 0xf0) === 0x60) len = 1 + (n + 1) * 2
      else if ((op & 0xf0) === 0x40) len = 2 + n
      else if ((op & 0xf0) === 0x50) len = 2
      else throw new Error(`comando XGC desconocido ${op.toString(16)} en ${q}`)
      f.cmds.push({ op, args: Array.from(xgc.subarray(q + 1, q + len)) })
      if (op === 0x7e) loop = xgc[q + 1] | (xgc[q + 2] << 8) | (xgc[q + 3] << 16)
      if (op === 0x7f) ended = true
      q += len
    }
    expect(q, `el frame de ${p} no acaba donde dice`).toBe(p + size)
    frames.push(f)
    p += size
  }
  expect(p).toBe(xgc.length)
  return { samples, sampleBytes, frames, loop, ended, musicStart }
}
const pcmOf = (f: Frame): { ch: number; id: number }[] => f.cmds.filter((c) => (c.op & 0xf0) === 0x50).map((c) => ({ ch: c.op & 3, id: c.args[0] }))

// ═════════════════════════════════════════════════════════════════════════════
describe('XGC: la música compilada para el driver del Z80', () => {
  it('cada tema generado da un XGC bien formado: frames encadenados, bucle en un inicio de frame y nada por encima de 255 bytes', () => {
    for (const st of STYLES) {
      const song = generateSong({ style: st.id, seed: 5, key: 2 })
      const xgm = buildXgm(song)
      const out = compileXgc(xgm)
      const x = readXgc(out.data)
      expect(Math.max(...x.frames.map((f) => f.size)), st.id).toBeLessThanOrEqual(255)
      expect(out.maxFrameBytes, st.id).toBe(Math.max(...x.frames.map((f) => f.size)))
      // tabla de muestras: seguidas, alineadas a 256 y dentro del bloque
      let next = 0
      for (const s of x.samples) {
        expect(s.addr, st.id).toBe(next)
        expect(s.len % 256, st.id).toBe(0)
        next += s.len
      }
      expect(next, st.id).toBe(x.sampleBytes)
      expect(out.sampleBytes, st.id).toBe(x.sampleBytes)
      // todos los temas generados tienen bucle: apunta al principio de un frame, pasado el margen inicial
      expect(x.loop, st.id).toBeGreaterThan(0)
      const target = x.frames.findIndex((f) => f.at === x.loop)
      expect(target, st.id).toBeGreaterThanOrEqual(XGC_PCM_ADVANCE)
      // en frames de música: uno partido en dos (por pasar de 250 bytes) cuenta como uno
      const split = (upTo: number): number => x.frames.slice(0, upTo).filter((f) => f.cmds.some((c) => c.op === 0x7d)).length
      expect(out.loopFrame, st.id).toBe(target - split(target))
      expect(out.frames, st.id).toBe(x.frames.length - split(x.frames.length))
      // el comando de bucle va en el último frame, tras un "salta frame"
      const last = x.frames[x.frames.length - 1].cmds.map((c) => c.op)
      expect(last.slice(-3), st.id).toEqual([0x7d, 0x7e, 0x7f])
      // los identificadores de PCM existen
      for (const f of x.frames) for (const p of pcmOf(f)) expect(p.id >= 1 && p.id <= x.samples.length, st.id).toBe(true)
      // ningún frame dispara dos PCM en el mismo canal
      for (const f of x.frames) expect(new Set(pcmOf(f).map((p) => p.ch)).size, st.id).toBe(pcmOf(f).length)
    }
  })

  it('un tema sin bucle acaba con el comando de fin', () => {
    const x = readXgc(compileXgc(buildXgm(tune({ fm1: [{ step: 0, len: 4, note: 60, vel: 12 }] }))).data)
    expect(x.loop).toBe(-1)
    expect(x.ended).toBe(true)
    expect(x.frames[x.frames.length - 1].cmds.map((c) => c.op)).toEqual([0x7f])
  })

  it(`los golpes de PCM van ${XGC_PCM_ADVANCE} frames por delante (lo que tarda el búfer del driver) y el bucle repone los suyos`, () => {
    // bombo en el primer paso y a mitad del primer compás (1 s a 120 BPM)
    const song = tune({ ch6: [{ step: 0, len: 1, note: 0, vel: 15 }, { step: 8, len: 1, note: 0, vel: 15 }] })
    const x = readXgc(compileXgc(buildXgm(song)).data)
    const hits = x.frames.map((f, i) => (pcmOf(f).length ? i : -1)).filter((i) => i >= 0)
    // el tema empieza en el frame 3 del XGC: el golpe del paso 0 cae en el frame 0
    expect(hits).toEqual([0, Math.floor(XGM_FPS)])

    // con bucle desde el principio, el golpe del paso 0 se repite al final para que suene al volver
    const looped: Song = { ...song, loopStart: 0 }
    const y = readXgc(compileXgc(buildXgm(looped)).data)
    const n = y.frames.length
    const withPcm = y.frames.map((f, i) => (pcmOf(f).length ? i : -1)).filter((i) => i >= 0)
    expect(withPcm.slice(0, 2)).toEqual([0, Math.floor(XGM_FPS)])
    expect(withPcm.some((i) => i >= n - 1 - XGC_PCM_ADVANCE)).toBe(true)
    expect(y.loop).toBe(y.frames[XGC_PCM_ADVANCE].at)
  })

  it('si adelantar los PCM desborda un frame que estaba al límite, se recompila partiéndolo antes', () => {
    // XGM escrito a mano: un frame con 248 bytes de escrituras al YM (no llega a partirse) y, tres
    // frames después, cuatro PCM que al adelantarse caen justo en él: 249 + 8 = 257 bytes
    const music: number[] = []
    for (let k = 0; k < 7; k++) {
      music.push(0x2f)
      for (let i = 0; i < 16; i++) music.push(0x30 + ((k * 16 + i) % 0x50), i)
    }
    music.push(0x27)
    for (let i = 0; i < 8; i++) music.push(0xa0 + (i % 3), i)
    music.push(0x00, 0x00, 0x00)
    music.push(0x50, 1, 0x51, 1, 0x52, 1, 0x53, 1, 0x00)
    music.push(0x00, 0x7f)
    const at = 0x104 + 256
    const xgm = new Uint8Array(at + 4 + music.length)
    xgm.set([0x58, 0x47, 0x4d, 0x20])
    for (let i = 0; i < 63; i++) xgm.set(i === 0 ? [0, 0, 1, 0] : [0xff, 0xff, 1, 0], 4 + i * 4)
    xgm[0x100] = 1
    xgm[0x102] = 1
    xgm[at] = music.length & 0xff
    xgm[at + 1] = music.length >> 8
    xgm.set(music, at + 4)

    const out = compileXgc(xgm)
    expect(out.maxFrameBytes).toBeLessThanOrEqual(255)
    const x = readXgc(out.data)
    // el frame gordo va en dos trozos que el driver lee seguidos, y no se pierde nada
    expect(x.frames.some((f) => f.cmds.some((c) => c.op === 0x7d))).toBe(true)
    expect(x.frames.flatMap(pcmOf)).toHaveLength(4)
    const ym = x.frames.flatMap((f) => f.cmds.filter((c) => (c.op & 0xf0) === 0x20)).reduce((n, c) => n + c.args.length / 2, 0)
    expect(ym).toBe(7 * 16 + 8)
    expect(out.frames).toBe(XGC_PCM_ADVANCE + 6)
  })

  it('las etiquetas del frame cuadran: un PSG primero, luego el FM y al final el PCM', () => {
    const song = tune({ fm1: [{ step: 4, len: 4, note: 48, vel: 13 }], sq1: [{ step: 4, len: 4, note: 72, vel: 13 }], ch6: [{ step: 4, len: 1, note: 1, vel: 15 }] })
    const x = readXgc(compileXgc(buildXgm(song)).data)
    // paso 4 a 120 BPM = 0,5 s
    const f = x.frames[XGC_PCM_ADVANCE + Math.floor(0.5 * XGM_FPS)]
    const kinds = f.cmds.map((c) => ((c.op & 0xf0) === 0x10 ? 'psg' : (c.op & 0xf0) === 0x50 ? 'pcm' : (c.op & 0xf0) === 0x60 ? 'estado' : 'fm'))
    expect(kinds[0]).toBe('psg')
    expect(kinds.indexOf('fm')).toBeGreaterThan(kinds.lastIndexOf('psg'))
    expect(kinds.includes('pcm')).toBe(false) // el suyo salió tres frames antes
    expect(pcmOf(x.frames[Math.floor(0.5 * XGM_FPS)])).toHaveLength(1)
  })
})

describe('XGM: lo que el emulador obligó a corregir', () => {
  /** frames del XGM: lista de comandos [código, …datos] */
  const xgmFrames = (xgm: Uint8Array): number[][][] => {
    const slen = (xgm[0x100] | (xgm[0x101] << 8)) << 8
    let p = 0x104 + slen + 4
    const frames: number[][][] = [[]]
    for (;;) {
      const c = xgm[p]
      if (c === 0x7f || c === 0x7e) break
      if (c === 0x00) {
        frames.push([])
        p++
        continue
      }
      const n = (c & 0x0f) + 1
      const len = (c & 0xf0) === 0x50 ? 2 : (c & 0xf0) === 0x20 || (c & 0xf0) === 0x30 ? 1 + 2 * n : 1 + n
      frames[frames.length - 1].push(Array.from(xgm.subarray(p, p + len)))
      p += len
    }
    return frames
  }

  it(`el tiempo va a ${XGM_FPS} frames por segundo (el retrazo de una Mega Drive NTSC) y las muestras a ${XGM_PCM_RATE} Hz`, () => {
    expect(XGM_FPS).toBeCloseTo(53693175 / 3420 / 262, 3)
    expect(XGM_PCM_RATE).toBe(14000)
    // un bombo cada segundo durante 8 s: su frame es el segundo × 59,92, no × 60
    const song = tune({ ch6: Array.from({ length: 8 }, (_, k) => ({ step: k * 8, len: 1, note: 0, vel: 15 })) }, (s) => (s.patterns[0].bars = 4))
    const frames = xgmFrames(buildXgm(song))
    const hits = frames.map((f, i) => (f.some((c) => (c[0] & 0xf0) === 0x50) ? i : -1)).filter((i) => i >= 0)
    expect(hits).toEqual(Array.from({ length: 8 }, (_, k) => Math.floor(k * XGM_FPS)))
    // la muestra del bombo dura lo que dura a 14 kHz
    const xgm = buildXgm(song)
    const len = (xgm[6] | (xgm[7] << 8)) << 8
    expect(len / XGM_PCM_RATE).toBeGreaterThan(0.2)
    expect(len / XGM_PCM_RATE).toBeLessThan(0.6)
  })

  it('cada frame lleva como mucho una atenuación por canal del PSG (la última)', () => {
    for (const style of ['cosmic', 'minimal', 'era'] as const) {
      const frames = xgmFrames(buildXgm(generateSong({ style, seed: 9, key: 4 })))
      for (const f of frames) {
        const seen = new Set<number>()
        for (const c of f) {
          if ((c[0] & 0xf0) !== 0x10) continue
          for (const b of c.slice(1)) {
            if ((b & 0x90) !== 0x90) continue
            expect(seen.has((b >> 5) & 3), style).toBe(false)
            seen.add((b >> 5) & 3)
          }
        }
      }
    }
  })

  it('un plato no lo corta el cuarto charles: cada golpe va al canal que antes queda libre', () => {
    // plato largo y, detrás, seis charles seguidos
    const song = tune({ ch6: [{ step: 0, len: 1, note: 7, vel: 15 }, ...[1, 2, 3, 4, 5, 6].map((s) => ({ step: s, len: 1, note: 2, vel: 12 }))] }, (s) => {
      s.drumKit[7] = { name: 'CRASH', kind: 'crash', pitch: 0.5, decay: 0.9, tone: 0.5, gain: 0.8 }
    })
    const frames = xgmFrames(buildXgm(song))
    const pcm = frames.flatMap((f) => f.filter((c) => (c[0] & 0xf0) === 0x50).map((c) => ({ ch: c[0] & 3, id: c[1] })))
    expect(pcm).toHaveLength(7)
    const crashChannel = pcm[0].ch
    // los charles se reparten por los otros tres canales y ninguno pisa el del plato
    expect(pcm.slice(1).every((p) => p.ch !== crashChannel)).toBe(true)
    expect(new Set(pcm.slice(1).map((p) => p.ch)).size).toBe(3)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('ROM', () => {
  it('la reproductora que viaja con la app es la de Chip Console', () => {
    expect(isPlayerRom(PLAYER)).toBe(true)
    expect(PLAYER.length).toBeLessThanOrEqual(ROM_SONG_BASE)
    expect(PLAYER.length % 256).toBe(0)
    expect(isPlayerRom(new Uint8Array(4096))).toBe(false)
    expect(() => buildRom(tune({}), new Uint8Array(4096))).toThrow()
  })

  it('reproductora + ficha + tema: cabecera, suma de control y direcciones', () => {
    const song = generateSong({ style: 'cosmic', seed: 21, key: 9 })
    song.title = 'Órbita Ñandú nº 7 «versión larguísima para la cabecera»'
    song.author = 'Ñu · TZOOTZ'
    const { rom, info, xgc } = buildRom(song, PLAYER)
    const text = (at: number, n: number): string => String.fromCharCode(...rom.subarray(at, at + n))
    // tamaño: múltiplo de 128 KB, con sitio para todo
    expect(rom.length % 0x20000).toBe(0)
    expect(info.size).toBe(rom.length)
    expect(rom.length).toBeGreaterThanOrEqual(ROM_SONG_BASE + 0x100 + xgc.data.length)
    // la reproductora no se toca (salvo la cabecera)
    expect(Array.from(rom.subarray(0x200, PLAYER.length))).toEqual(Array.from(PLAYER.subarray(0x200)))
    expect(text(0x100, 15)).toBe('SEGA MEGA DRIVE')
    // título en los dos campos de la cabecera, en ASCII
    expect(text(0x120, 48)).toBe(text(0x150, 48))
    expect(text(0x120, 48)).toMatch(/^ORBITA NANDU N 7 VERSION LARGUISIMA/)
    expect(/^[\x20-\x5f]+$/.test(text(0x120, 48))).toBe(true)
    // final de la ROM y suma de control
    expect(((rom[0x1a4] << 24) | (rom[0x1a5] << 16) | (rom[0x1a6] << 8) | rom[0x1a7]) >>> 0).toBe(rom.length - 1)
    const stored = (rom[0x18e] << 8) | rom[0x18f]
    expect(stored).toBe(romChecksum(rom))
    // ficha
    expect(text(ROM_SONG_BASE, 4)).toBe('TZMD')
    expect(rom[ROM_SONG_BASE + 4]).toBe(1)
    expect(rom[ROM_SONG_BASE + 5]).toBe(1)
    expect((rom[ROM_SONG_BASE + 6] << 8) | rom[ROM_SONG_BASE + 7]).toBe(song.bpm)
    const frames = ((rom[ROM_SONG_BASE + 8] << 24) | (rom[ROM_SONG_BASE + 9] << 16) | (rom[ROM_SONG_BASE + 10] << 8) | rom[ROM_SONG_BASE + 11]) >>> 0
    expect(frames).toBe(info.frames)
    expect(frames / XGM_FPS).toBeGreaterThan(100)
    expect(text(ROM_SONG_BASE + 0x10, 40).replace(/\0+$/, '')).toBe('ORBITA NANDU N 7 VERSION LARGUISIMA PARA')
    expect(text(ROM_SONG_BASE + 0x38, 40).replace(/\0+$/, '')).toBe('NU TZOOTZ')
    expect(text(ROM_SONG_BASE + 0x60, 40).replace(/\0+$/, '')).toMatch(/^A MENOR NATURAL - \d+ BPM - \d:\d\d$/)
    // el tema, alineado a 256 (lo exige el driver para las muestras) y tal cual sale del compilador
    expect((ROM_SONG_BASE + 0x100) % 256).toBe(0)
    expect(Array.from(rom.subarray(ROM_SONG_BASE + 0x100, ROM_SONG_BASE + 0x100 + 64))).toEqual(Array.from(xgc.data.subarray(0, 64)))
    expect(rom[ROM_SONG_BASE + 0x100 + xgc.data.length - 1]).toBe(xgc.data[xgc.data.length - 1])
  })

  it('el texto para la consola va en mayúsculas ASCII y sin acentos', () => {
    expect(romText('Canción nº 1 — ¡ÑU!', 40)).toBe('CANCION N 1 NU!')
    expect(romText('  muchos   espacios  ', 40)).toBe('MUCHOS ESPACIOS')
    expect(romText('abcdefghij', 4)).toBe('ABCD')
    expect(romText('日本語', 10)).toBe('')
  })

  it('los siete estilos caben de sobra en un cartucho', () => {
    for (const st of STYLES) {
      const { rom, info } = buildRom(generateSong({ style: st.id, seed: 3, key: 0 }), PLAYER)
      expect(rom.length, st.id).toBeLessThanOrEqual(0x80000)
      expect(info.maxFrameBytes, st.id).toBeLessThanOrEqual(255)
      expect(info.loop, st.id).toBe(true)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
//  Con las herramientas reales (opcional)
// ═════════════════════════════════════════════════════════════════════════════
const SR = 48000
let dir = ''
const work = (): string => (dir ||= mkdtempSync(join(tmpdir(), 'tzrom-')))

/** paso-alto de 2º orden a 20 Hz, como el de la app: quita la continua (DAC en reposo, PSG unipolar) */
function highpass(x: Float32Array): Float32Array {
  const w0 = (2 * Math.PI * 20) / SR
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
  const cos = Math.cos(w0)
  const b0 = (1 + cos) / 2 / (1 + alpha)
  const b1 = -(1 + cos) / (1 + alpha)
  const a1 = (-2 * cos) / (1 + alpha)
  const a2 = (1 - alpha) / (1 + alpha)
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b0 * (x[i] + x2) + b1 * x1 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** arranca la ROM en MAME sin ventana y devuelve lo que suena (mono, 48 kHz, sin continua) */
function playInMame(name: string, song: Song, seconds: number): Float32Array {
  const { rom } = buildRom(song, PLAYER)
  writeFileSync(join(work(), `${name}.bin`), rom)
  execFileSync(join(MAME, 'mame.exe'), ['genesis', '-cart', `${name}.bin`, '-rompath', join(MAME, 'roms'), '-hashpath', join(MAME, 'hash'), '-pluginspath', join(MAME, 'plugins'), '-video', 'none', '-sound', 'none', '-nothrottle', '-skip_gameinfo', '-seconds_to_run', String(seconds), '-wavwrite', `${name}.wav`, '-nomouse', '-nojoy'], { cwd: work(), stdio: 'ignore' })
  const b = readFileSync(join(work(), `${name}.wav`))
  let p = 12
  while (b.toString('latin1', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4)
  expect(b.readUInt32LE(24)).toBe(SR)
  const n = Math.floor(Math.min(b.readUInt32LE(p + 4), b.length - p - 8) / 4)
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) m[i] = (b.readInt16LE(p + 8 + i * 4) + b.readInt16LE(p + 10 + i * 4)) / 65536
  // la salida de la máquina arranca en cero y sube a la continua del DAC: se iguala ese tramo
  const idle = m[Math.round(0.3 * SR)]
  m.fill(idle, 0, Math.round(0.3 * SR))
  return highpass(m)
}
function ownMono(song: Song): Float32Array {
  const a = renderSong(song, { sampleRate: SR, tail: 1, model: 'md1' })
  const m = new Float32Array(a.left.length)
  for (let i = 0; i < m.length; i++) m[i] = (a.left[i] + a.right[i]) / 2
  return m
}
const rmsOf = (x: Float32Array, a: number, b: number): number => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}
function onset(x: Float32Array, from = 0): number {
  let pk = 0
  for (let i = from; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]))
  for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > pk * 0.1) return i
  return from
}
/** envolvente RMS en ventanas de 10 ms, suavizada a 50 ms (el XGM cuantiza a frames) */
function envelope(x: Float32Array): Float64Array {
  const win = SR / 100
  const n = Math.floor(x.length / win)
  const e = new Float64Array(n)
  for (let i = 0; i < n; i++) e[i] = rmsOf(x, i * win, (i + 1) * win)
  return e.map((_, i) => (e[Math.max(0, i - 2)] + e[Math.max(0, i - 1)] + e[i] + e[Math.min(n - 1, i + 1)] + e[Math.min(n - 1, i + 2)]) / 5)
}
function correlation(a: Float64Array, b: Float64Array, lag: number, from: number, len: number): number {
  let sa = 0
  let sb = 0
  let n = 0
  for (let i = from; i < from + len && i < a.length && i + lag < b.length; i++) {
    sa += a[i]
    sb += b[i + lag]
    n++
  }
  sa /= n
  sb /= n
  let num = 0
  let da = 0
  let dbb = 0
  for (let i = from; i < from + len && i < a.length && i + lag < b.length; i++) {
    num += (a[i] - sa) * (b[i + lag] - sb)
    da += (a[i] - sa) ** 2
    dbb += (b[i + lag] - sb) ** 2
  }
  return num / Math.sqrt(da * dbb + 1e-30)
}
/** desfase (en ventanas de 10 ms) que mejor casa las dos envolventes en un tramo */
function bestLag(a: Float64Array, b: Float64Array, from: number, len: number, lo: number, hi: number): { lag: number; c: number } {
  let best = { lag: lo, c: -2 }
  for (let lag = lo; lag <= hi; lag++) {
    const c = correlation(a, b, lag, from, len)
    if (c > best.c) best = { lag, c }
  }
  return best
}

describe.skipIf(!OPT_IN)('contra xgmtool (SGDK)', () => {
  it('el XGC sale idéntico byte a byte al de la herramienta oficial', () => {
    const tool = join(SGDK, 'bin', 'xgmtool.exe')
    expect(existsSync(tool), `no encuentro ${tool}: indica la carpeta de SGDK con TZ_SGDK`).toBe(true)
    const songs: [string, Song][] = []
    for (const st of STYLES) for (const seed of [1, 7]) songs.push([`${st.id}${seed}`, generateSong({ style: st.id, seed, key: 3 })])
    songs.push(['corto', generateSong({ style: 'cosmic', seed: 4, key: 0, bars: 4 })])
    songs.push(['sinbucle', tune({ fm1: [{ step: 0, len: 8, note: 48, vel: 13 }], sq1: [{ step: 2, len: 4, note: 72, vel: 12 }], ch6: [{ step: 0, len: 1, note: 0, vel: 15 }, { step: 4, len: 1, note: 1, vel: 9 }] })])
    songs.push(['vacio', tune({})])
    const rows: string[] = []
    for (const [name, song] of songs) {
      const xgm = buildXgm(song)
      writeFileSync(join(work(), `${name}.xgm`), xgm)
      execFileSync(tool, [`${name}.xgm`, `${name}.xgc`, '-s'], { cwd: work(), stdio: 'ignore' })
      const ref = new Uint8Array(readFileSync(join(work(), `${name}.xgc`)))
      const own = compileXgc(xgm).data
      rows.push(`${name.padEnd(11)} XGM ${String(xgm.length).padStart(7)} → XGC ${String(own.length).padStart(7)} bytes`)
      expect(own.length, name).toBe(ref.length)
      let diff = -1
      for (let i = 0; i < ref.length && diff < 0; i++) if (ref[i] !== own[i]) diff = i
      expect(diff, `${name}: primer byte distinto`).toBe(-1)
    }
    console.log(`\nXGC idéntico al de xgmtool en ${songs.length} temas\n${rows.join('\n')}`)
  }, 300000)
})

describe.skipIf(!OPT_IN)('la ROM en una Mega Drive emulada (MAME)', () => {
  it('MAME está donde se espera', () => {
    expect(existsSync(join(MAME, 'mame.exe')), `no encuentro mame.exe en ${MAME}: indica su carpeta con TZ_MAME`).toBe(true)
  })

  it('FM y PSG afinan como en la app; el PCM suena a su nivel y a la frecuencia del driver', () => {
    const rows: string[] = []
    const cases: [string, Song, number][] = [
      ['FM (seno, La4)', tune({ fm1: [{ step: 0, len: 24, note: 69, vel: 15 }] }, sine), 440],
      ['PSG (cuadrada, La4)', tune({ sq1: [{ step: 0, len: 24, note: 69, vel: 15 }] }, square), 440],
      [
        'PCM (timbal en La2)',
        tune({ ch6: [{ step: 0, len: 1, note: 5, vel: 15 }] }, (s) => {
          s.drumKit[5] = { name: 'TIMP', kind: 'timp', pitch: timpPitch(45), decay: 0.9, tone: 0.3, gain: 0.9 }
        }),
        110,
      ],
      ['PCM (bombo)', tune({ ch6: [{ step: 0, len: 1, note: 0, vel: 15 }] }), 0],
    ]
    const level: number[] = []
    const refLevel: number[] = []
    const cents: number[] = []
    const starts: number[] = []
    cases.forEach(([name, song], k) => {
      const a = ownMono(song)
      const b = playInMame(`nota${k}`, song, 5)
      const oa = onset(a)
      const ob = onset(b, Math.round(0.3 * SR))
      starts.push(ob / SR)
      const seg = (x: Float32Array, o: number): Float32Array => x.subarray(o + SR / 20, o + SR / 20 + SR / 2)
      const fa = cases[k][2] ? peakFreq(seg(a, oa), SR, 40) : 0
      const fb = cases[k][2] ? peakFreq(seg(b, ob), SR, 40) : 0
      level.push(db(rmsOf(a, oa, oa + SR / 2)))
      refLevel.push(db(rmsOf(b, ob, ob + SR / 2)))
      cents.push(fa ? 1200 * Math.log2(fb / fa) : 0)
      rows.push(`${name.padEnd(20)} app ${level[k].toFixed(1)} dB · ROM ${refLevel[k].toFixed(1)} dB` + (fa ? ` · tono app ${fa.toFixed(2)} Hz, ROM ${fb.toFixed(2)} Hz (${cents[k] >= 0 ? '+' : ''}${cents[k].toFixed(1)} cents)` : ''))
    })
    const rate = XGM_PCM_RATE * Math.pow(2, cents[2] / 1200)
    console.log(`\nLa ROM en MAME\n${rows.join('\n')}\nel tema arranca ${starts[0].toFixed(2)} s después de encender · el PCM se reproduce a ${Math.round(rate)} Hz`)
    // la nota es la misma, al cent
    expect(Math.abs(cents[0])).toBeLessThan(2)
    expect(Math.abs(cents[1])).toBeLessThan(2)
    // el PCM, entre la frecuencia nominal del driver (14 kHz; en la consola, 254 ciclos del Z80 por
    // muestra) y la que da un emulador que no frena al Z80 cuando lee del cartucho (≈ 14,7 kHz)
    expect(rate).toBeGreaterThan(13900)
    expect(rate).toBeLessThan(14800)
    // niveles respecto al FM: el PCM del driver, como el DAC de la app (±1,5 dB)
    const rel = (k: number): number => refLevel[k] - refLevel[0] - (level[k] - level[0])
    expect(Math.abs(rel(3))).toBeLessThan(1.5)
    // el PSG de MAME va algo más alto que el nuestro (es la referencia más generosa de las tres)
    expect(rel(1)).toBeGreaterThan(0)
    expect(rel(1)).toBeLessThan(5)
    // todo arranca a la vez
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(0.03)
  }, 300000)

  it('un tema entero: mismo tempo durante 50 s y la misma envolvente por familias (FM, PSG, PCM)', () => {
    const full = generateSong({ style: 'cosmic', seed: 21, key: 9 })
    const families: [string, string[], number][] = [
      ['todo', full.tracks.map((t) => t.id), 0.6],
      ['FM', ['fm1', 'fm2', 'fm3', 'fm4', 'fm5'], 0.8],
      ['PSG', ['sq1', 'sq2', 'sq3'], 0.8],
      ['PCM', ['ch6'], 0.85],
    ]
    const rows: string[] = []
    const gain: Record<string, number> = {}
    for (const [name, keep, min] of families) {
      const song: Song = { ...full, tracks: full.tracks.map((t) => ({ ...t, mute: !keep.includes(t.id) })) }
      const a = envelope(ownMono(song))
      const audio = playInMame(`tema_${name}`, song, name === 'todo' ? 55 : 35)
      const b = envelope(audio)
      const first = bestLag(a, b, 500, 2500, 30, 120)
      rows.push(`${name.padEnd(5)} desfase ${first.lag * 10} ms · correlación de envolventes ${first.c.toFixed(3)}`)
      expect(first.c, `${name}: la ROM no suena como el tema`).toBeGreaterThan(min)
      const from = 5 * SR
      const to = 30 * SR
      gain[name] = db(rmsOf(audio, from + first.lag * (SR / 100), to + first.lag * (SR / 100))) - db(rmsOf(ownMono(song), from, to))
      if (name === 'todo') {
        // deriva: el desfase a los 40–50 s es el mismo que al principio (±20 ms)
        const late = bestLag(a, b, 4000, 1000, first.lag - 10, first.lag + 10)
        rows.push(`      deriva a los 40–50 s: ${(late.lag - first.lag) * 10} ms`)
        expect(Math.abs(late.lag - first.lag)).toBeLessThanOrEqual(2)
      }
    }
    rows.push(`niveles respecto al FM: PSG ${(gain.PSG - gain.FM).toFixed(1)} dB · PCM ${(gain.PCM - gain.FM).toFixed(1)} dB`)
    console.log(`\nUn tema cosmic entero en MAME\n${rows.join('\n')}`)
    expect(Math.abs(gain.PCM - gain.FM)).toBeLessThan(2)
    expect(gain.PSG - gain.FM).toBeGreaterThan(0)
    expect(gain.PSG - gain.FM).toBeLessThan(6)
  }, 900000)
})
