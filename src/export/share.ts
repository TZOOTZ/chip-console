// ── Compartir: la canción entera dentro de la URL (sin servidor) ─────────────
//
// Contenedor binario (cabecera JSON + notas por columnas) → deflate → base64url.
// Los bancos de instrumentos que son idénticos a los de fábrica se omiten, así
// un tema generado cabe en 1-2,5 KB: entra en un solo mensaje de cualquier chat.
import { deflateSync, inflateSync, strFromU8, strToU8, zipSync } from 'fflate'
import { createEmptySong } from '../music/presets'
import { sanitizeSong, type Note, type Pan, type Song } from '../music/song'

const b64url = (u8: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const u8 = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i)
  return u8
}

type Packed = Record<string, unknown>

/**
 * Notas de una pista como lista plana `[Δpaso, duración, nota, velocidad, …]`.
 * Al guardar la distancia al paso anterior (y no el paso absoluto), los compases
 * que se repiten producen secuencias idénticas y deflate las reduce a casi nada.
 */
function packNotes(notes: Note[]): number[] {
  const out: number[] = []
  let prev = 0
  for (const n of notes) {
    out.push(n.step - prev, n.len, n.note, packVel(n))
    prev = n.step
  }
  return out
}

const PANS: (Pan | undefined)[] = [undefined, 'L', 'C', 'R']
/** la velocidad (1-15) lleva encima la ligadura (+16) y el panorama propio (+32 · L/C/R) */
const packVel = (n: Note): number => n.vel + (n.slide ? 16 : 0) + 32 * Math.max(0, PANS.indexOf(n.pan))
function unpackNote(step: number, len: number, note: number, v: number): Note {
  const n: Note = { step, len, note, vel: v & 15 }
  if (v & 16) n.slide = true
  const pan = PANS[(v >> 5) & 3]
  if (pan) n.pan = pan
  return n
}

/** inversa de packNotes; acepta también el formato antiguo `[[paso, dur, nota, vel], …]` */
function unpackNotes(raw: unknown): Note[] {
  const arr = Array.isArray(raw) ? raw : []
  if (arr.length > 0 && Array.isArray(arr[0])) {
    return arr.map((n) => {
      const x = Array.isArray(n) ? n : []
      return unpackNote(x[0] as number, x[1] as number, x[2] as number, Number(x[3]))
    })
  }
  const out: Note[] = []
  let step = 0
  for (let i = 0; i + 3 < arr.length; i += 4) {
    step += Number(arr[i])
    out.push(unpackNote(step, arr[i + 1] as number, arr[i + 2] as number, Number(arr[i + 3])))
  }
  return out
}

/** forma compacta serializable de una canción */
export function packSong(song: Song): Packed {
  const factory = createEmptySong()
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const out: Packed = {
    v: song.version,
    t: song.title,
    a: song.author,
    b: song.bpm,
    sw: song.swing,
    ...(song.swingGrid === 4 ? { sg: 4 } : {}),
    bp: song.beatsPerBar,
    k: song.key,
    sc: song.scale,
    dr: song.dacRate,
    lf: song.lfo,
    tr: song.tracks.map((t) => [t.id, t.name, t.kind, t.inst, t.vol, t.pan, t.mute ? 1 : 0, t.solo ? 1 : 0, t.gate, t.transpose, ...(t.glide ? [t.glide] : [])]),
    pt: song.patterns.map((p) => [
      p.id,
      p.name,
      p.bars,
      Object.fromEntries(
        Object.entries(p.notes)
          .filter(([, arr]) => arr.length > 0)
          .map(([k, arr]) => [k, packNotes(arr)]),
      ),
    ]),
    o: song.order,
    ls: song.loopStart,
  }
  if (!same(song.fmBank, factory.fmBank)) out.fm = song.fmBank
  if (!same(song.psgBank, factory.psgBank)) out.psg = song.psgBank
  if (!same(song.noiseKit, factory.noiseKit)) out.nz = song.noiseKit
  if (!same(song.drumKit, factory.drumKit)) out.dk = song.drumKit
  return out
}

export function unpackSong(raw: unknown): Song {
  const base = createEmptySong()
  const o = (raw && typeof raw === 'object' ? raw : {}) as Packed
  const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const full: Record<string, unknown> = {
    version: o.v,
    title: o.t,
    author: o.a,
    bpm: o.b,
    swing: o.sw,
    swingGrid: o.sg,
    beatsPerBar: o.bp,
    key: o.k,
    scale: o.sc,
    dacRate: o.dr,
    lfo: o.lf,
    fmBank: o.fm,
    psgBank: o.psg,
    noiseKit: o.nz,
    drumKit: o.dk,
    tracks: asArr(o.tr).map((t) => {
      const a = asArr(t)
      return { id: a[0], name: a[1], kind: a[2], inst: a[3], vol: a[4], pan: a[5], mute: a[6] === 1, solo: a[7] === 1, gate: a[8], transpose: a[9], glide: a[10] }
    }),
    patterns: asArr(o.pt).map((p) => {
      const a = asArr(p)
      const notes: Record<string, Note[]> = {}
      const src = (a[3] && typeof a[3] === 'object' ? a[3] : {}) as Record<string, unknown>
      for (const [k, arr] of Object.entries(src)) notes[k] = unpackNotes(arr)
      return { id: a[0], name: a[1], bars: a[2], notes }
    }),
    order: o.o,
    loopStart: o.ls,
  }
  return sanitizeSong(full, base)
}

// ── contenedor del enlace ───────────────────────────────────────────────────
// El primer byte dice el formato. Los enlaces antiguos son el JSON de packSong
// a secas (empiezan por «{») y se siguen leyendo.
const LINK_BINARY = 2
const LINK_JSON = 0x7b

function putVarint(out: number[], v: number): void {
  while (v > 127) {
    out.push((v & 127) | 128)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

/**
 * Contenedor binario: cabecera JSON (todo menos las notas) y, por patrón y pista, las notas en
 * cuatro columnas —Δpaso, duración, nota y velocidad— en vez de intercaladas. Cada columna se
 * parece muchísimo a sí misma y a la del patrón anterior aunque cambie otra (el mismo arpegio
 * tocado más flojo solo difiere en la de velocidad), así que deflate deja el enlace en poco más
 * de la mitad de lo que ocupaba como JSON.
 *
 *   [2] [varint n] [n bytes de JSON]
 *   por patrón:  [varint pistas con notas]
 *     por pista: [índice de pista] [varint notas] [Δpaso…] [duración…] [nota…] [velocidad…]
 */
function packLink(song: Song): Uint8Array {
  const meta = packSong(song)
  meta.pt = song.patterns.map((p) => [p.id, p.name, p.bars])
  const json = strToU8(JSON.stringify(meta))
  const out: number[] = [LINK_BINARY]
  putVarint(out, json.length)
  for (let i = 0; i < json.length; i++) out.push(json[i])
  for (const p of song.patterns) {
    const used = song.tracks.map((t, index) => ({ index, notes: p.notes[t.id] ?? [] })).filter((u) => u.notes.length > 0)
    putVarint(out, used.length)
    for (const u of used) {
      // en el orden en que quedan al cargar: así las distancias nunca son negativas
      const notes = [...u.notes].sort((a, b) => a.step - b.step || a.note - b.note)
      out.push(u.index)
      putVarint(out, notes.length)
      let prev = 0
      for (const n of notes) {
        putVarint(out, n.step - prev)
        prev = n.step
      }
      for (const n of notes) putVarint(out, n.len)
      for (const n of notes) out.push(n.note & 255)
      for (const n of notes) out.push(packVel(n))
    }
  }
  return Uint8Array.from(out)
}

function unpackLink(u8: Uint8Array): Song {
  let pos = 1
  const byte = (): number => {
    if (pos >= u8.length) throw new Error('enlace truncado')
    return u8[pos++]
  }
  const varint = (): number => {
    let v = 0
    for (let scale = 1; scale <= 2 ** 28; scale *= 128) {
      const b = byte()
      v += (b & 127) * scale
      if (b < 128) return v
    }
    throw new Error('enlace inválido')
  }
  const size = varint()
  if (pos + size > u8.length) throw new Error('enlace truncado')
  const meta = JSON.parse(strFromU8(u8.subarray(pos, pos + size))) as Packed
  pos += size
  const tracks = Array.isArray(meta.tr) ? (meta.tr as unknown[]) : []
  const patterns = Array.isArray(meta.pt) ? (meta.pt as unknown[]) : []
  meta.pt = patterns.map((p) => {
    const a = Array.isArray(p) ? (p as unknown[]) : []
    const notes: Record<string, number[]> = {}
    for (let used = varint(); used > 0; used--) {
      const track = tracks[byte()]
      const count = varint()
      if (count * 4 > u8.length - pos) throw new Error('enlace truncado')
      const flat = new Array<number>(count * 4)
      for (let col = 0; col < 4; col++) for (let i = 0; i < count; i++) flat[i * 4 + col] = col < 2 ? varint() : byte()
      const id = Array.isArray(track) ? (track as unknown[])[0] : undefined
      if (typeof id === 'string') notes[id] = flat
    }
    return [a[0], a[1], a[2], notes]
  })
  return unpackSong(meta)
}

export function songToHash(song: Song): string {
  return b64url(deflateSync(packLink(song), { level: 9 }))
}

export function songFromHash(hash: string): Song {
  const u8 = inflateSync(fromB64url(hash))
  if (u8[0] === LINK_BINARY) return unpackLink(u8)
  if (u8[0] !== LINK_JSON) throw new Error('enlace inválido')
  return unpackSong(JSON.parse(strFromU8(u8)))
}

/** URL completa de compartir para la ubicación actual */
export function shareUrl(song: Song, origin = typeof location !== 'undefined' ? location.origin + location.pathname : ''): string {
  return `${origin}#s=${songToHash(song)}`
}

export function songFromLocationHash(hash: string): Song | null {
  const m = /^#?s=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!m) return null
  try {
    return songFromHash(m[1])
  } catch {
    return null
  }
}

/** proyecto en JSON legible (para guardar a disco) */
export function songToProjectFile(song: Song): string {
  // una clave por línea (legible) con los arrays compactos
  const parts = Object.entries(song).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return '{\n' + parts.join(',\n') + '\n}\n'
}

export function songFromProjectFile(text: string): Song {
  return sanitizeSong(JSON.parse(text), createEmptySong())
}

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 0 })
}
