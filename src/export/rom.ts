// ── Exportador a ROM de Mega Drive (.bin) ───────────────────────────────────
//
// La ROM es la reproductora de `rom/player` (un programa mínimo hecho con SGDK:
// pinta la ficha del tema y lo toca con el driver XGM del Z80) más los datos del
// tema, que se escriben a partir de SONG_BASE: una ficha de 256 bytes y, detrás,
// la música compilada (XGC). El resultado arranca en una consola con un cartucho
// flash y en cualquier emulador.
//
// La reproductora se compila aparte (`npm run rom:build`, necesita SGDK) y viaja
// con la app como un binario ya hecho; aquí solo se le añade el tema y se corrigen
// la cabecera y la suma de control.
import { pitchClassName, scaleById } from '../music/theory'
import type { Song } from '../music/song'
import { compileXgc, type Xgc } from './xgc'
import { buildXgm } from './xgm'

/** dirección de la ROM donde la reproductora espera el tema (ver rom/player/src/main.c) */
export const ROM_SONG_BASE = 0x20000
/** las ROM se rellenan a múltiplos de 128 KB, como hace SGDK */
const ROM_ALIGN = 0x20000
/** tope de un cartucho sin mapeador */
export const ROM_MAX = 0x400000
const INFO_SIZE = 0x100

export interface RomInfo {
  /** tamaño final de la ROM en bytes */
  size: number
  /** duración en frames de 1/60 s (con bucle, hasta que vuelve) */
  frames: number
  loop: boolean
  /** bytes de música compilada y de muestras PCM */
  musicBytes: number
  sampleBytes: number
  /** el frame más cargado, en bytes (el driver admite 255) */
  maxFrameBytes: number
}

/** texto para la fuente de la consola: mayúsculas ASCII, sin acentos */
export function romText(s: string, max: number): string {
  const plain = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\x20-\x5f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, max).trimEnd()
}

const clock = (frames: number): string => {
  const secs = Math.floor(frames / 60)
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

function putText(rom: Uint8Array, at: number, text: string, width: number, pad: number): void {
  for (let i = 0; i < width; i++) rom[at + i] = i < text.length ? text.charCodeAt(i) : pad
}

/** suma de control de la cabecera: suma de las palabras de 16 bits desde $200 */
export function romChecksum(rom: Uint8Array): number {
  let sum = 0
  for (let i = 0x200; i + 1 < rom.length; i += 2) sum = (sum + ((rom[i] << 8) | rom[i + 1])) & 0xffff
  return sum
}

/** ¿es `bytes` la reproductora de Chip Console? */
export function isPlayerRom(bytes: Uint8Array): boolean {
  const at = (o: number, s: string): boolean => bytes.length > o + s.length && [...s].every((ch, i) => bytes[o + i] === ch.charCodeAt(0))
  return bytes.length <= ROM_SONG_BASE && at(0x100, 'SEGA MEGA DRIVE') && at(0x120, 'TZOOTZ CHIP CONSOLE')
}

/**
 * Monta la ROM: reproductora + ficha + tema compilado.
 * `player` es el binario de rom/player (tal cual o sin su relleno final).
 */
export function buildRom(song: Song, player: Uint8Array): { rom: Uint8Array; info: RomInfo; xgc: Xgc } {
  if (!isPlayerRom(player)) throw new Error('La ROM reproductora no es válida')
  const xgc = compileXgc(buildXgm(song))
  if (xgc.maxFrameBytes > 255) throw new Error('Hay demasiadas escrituras en un solo frame para el driver XGM')
  const end = ROM_SONG_BASE + INFO_SIZE + xgc.data.length
  const size = Math.ceil(end / ROM_ALIGN) * ROM_ALIGN
  if (size > ROM_MAX) throw new Error(`El tema no cabe en una ROM de ${ROM_MAX >> 20} MB`)

  const rom = new Uint8Array(size)
  rom.set(player, 0)

  // ── ficha ──
  const loop = xgc.loopFrame >= 0
  // tres de los frames son el margen del arranque
  const frames = Math.max(0, xgc.frames - 3)
  const info = ROM_SONG_BASE
  putText(rom, info, 'TZMD', 4, 0)
  rom[info + 4] = 1
  rom[info + 5] = loop ? 1 : 0
  rom[info + 6] = (song.bpm >> 8) & 0xff
  rom[info + 7] = song.bpm & 0xff
  rom[info + 8] = (frames >>> 24) & 0xff
  rom[info + 9] = (frames >> 16) & 0xff
  rom[info + 10] = (frames >> 8) & 0xff
  rom[info + 11] = frames & 0xff
  const title = romText(song.title, 40) || 'SIN TITULO'
  putText(rom, info + 0x10, title, 40, 0)
  putText(rom, info + 0x38, romText(song.author, 40), 40, 0)
  const key = `${pitchClassName(song.key)} ${scaleById(song.scale).name}`
  putText(rom, info + 0x60, romText(`${key} - ${song.bpm} BPM - ${clock(frames)}`, 40), 40, 0)

  // ── tema ──
  rom.set(xgc.data, ROM_SONG_BASE + INFO_SIZE)

  // ── cabecera: título (nacional e internacional), final de la ROM y suma de control ──
  const name = romText(`${title} - TZOOTZ CHIP CONSOLE`, 48)
  putText(rom, 0x120, name, 48, 0x20)
  putText(rom, 0x150, name, 48, 0x20)
  const last = size - 1
  rom[0x1a4] = (last >>> 24) & 0xff
  rom[0x1a5] = (last >> 16) & 0xff
  rom[0x1a6] = (last >> 8) & 0xff
  rom[0x1a7] = last & 0xff
  rom[0x18e] = 0
  rom[0x18f] = 0
  const sum = romChecksum(rom)
  rom[0x18e] = sum >> 8
  rom[0x18f] = sum & 0xff

  return { rom, info: { size, frames, loop, musicBytes: xgc.data.length - 0x104 - xgc.sampleBytes, sampleBytes: xgc.sampleBytes, maxFrameBytes: xgc.maxFrameBytes }, xgc }
}
