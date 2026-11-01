// ── Render offline: canción → audio estéreo (WAV, stems, medidas) ────────────
import type { SoundModel } from '../core/mixer'
import { Synth } from '../engine/synth'
import type { Song } from '../music/song'

export interface RenderOptions {
  sampleRate?: number
  /** pasadas de la sección en bucle (la intro antes de loopStart suena una vez) */
  loops?: number
  /** cola máxima tras el último paso (s) */
  tail?: number
  /** límite de seguridad (s) */
  maxSeconds?: number
  /** carácter de sonido: 'md1' (por defecto, Model 1) o 'clean' */
  model?: SoundModel
  onProgress?: (fraction: number) => void
}

export interface RenderedAudio {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

/** repite la sección de bucle `loops` veces y desactiva el bucle */
export function unrollLoops(song: Song, loops: number): Song {
  const ls = song.loopStart < 0 ? 0 : Math.min(song.loopStart, song.order.length - 1)
  const intro = song.order.slice(0, ls)
  const body = song.order.slice(ls)
  const order = [...intro]
  for (let i = 0; i < Math.max(1, loops); i++) order.push(...body)
  return { ...song, order, loopStart: -1 }
}

export function renderSong(song: Song, opts: RenderOptions = {}): RenderedAudio {
  const sr = opts.sampleRate ?? 44100
  const loops = opts.loops ?? 1
  const tail = opts.tail ?? 3
  const maxSamples = Math.round((opts.maxSeconds ?? 900) * sr)
  const src = unrollLoops(song, loops)

  const synth = new Synth(sr, src, opts.model ?? 'md1')
  synth.stopAtEnd = true
  synth.play(0, 0)

  const chunkLen = 8192
  const lefts: Float32Array[] = []
  const rights: Float32Array[] = []
  let total = 0
  let tailSamples = 0
  let quiet = 0
  const approxTotal = Math.max(1, Math.round(((60 * sr) / (src.bpm * 4)) * src.order.reduce((n, id) => {
    const p = src.patterns.find((x) => x.id === id)
    return n + (p ? p.bars * src.beatsPerBar * 4 : 0)
  }, 0)))

  while (total < maxSamples) {
    const l = new Float32Array(chunkLen)
    const r = new Float32Array(chunkLen)
    synth.render(l, r, chunkLen)
    lefts.push(l)
    rights.push(r)
    total += chunkLen
    opts.onProgress?.(Math.min(1, total / approxTotal))
    if (!synth.playing) {
      tailSamples += chunkLen
      // fin: cola de liberación hasta silencio real o el máximo
      let pk = 0
      for (let i = 0; i < chunkLen; i += 8) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]))
      quiet = pk < 0.0008 && synth.isSilent() ? quiet + 1 : 0
      if (quiet >= 2 || tailSamples >= tail * sr) break
    }
  }

  const left = new Float32Array(total)
  const right = new Float32Array(total)
  let o = 0
  for (let i = 0; i < lefts.length; i++) {
    left.set(lefts[i], o)
    right.set(rights[i], o)
    o += chunkLen
  }
  return { left, right, sampleRate: sr }
}

/** Un stem por pista (el resto silenciado). Devuelve [id, audio]. */
export function renderStems(song: Song, opts: RenderOptions = {}): [string, RenderedAudio][] {
  const out: [string, RenderedAudio][] = []
  const active = song.tracks.filter((t) => !t.mute)
  for (let i = 0; i < active.length; i++) {
    const tr = active[i]
    const solo: Song = {
      ...song,
      tracks: song.tracks.map((t) => ({ ...t, solo: t.id === tr.id, mute: false })),
    }
    // omite pistas sin ninguna nota
    const hasNotes = song.patterns.some((p) => (p.notes[tr.id]?.length ?? 0) > 0)
    if (!hasNotes) continue
    out.push([tr.id, renderSong(solo, { ...opts, onProgress: undefined })])
    opts.onProgress?.((i + 1) / active.length)
  }
  return out
}

export function peakOf(a: RenderedAudio): number {
  let pk = 0
  for (let i = 0; i < a.left.length; i++) {
    const l = Math.abs(a.left[i])
    const r = Math.abs(a.right[i])
    if (l > pk) pk = l
    if (r > pk) pk = r
  }
  return pk
}

/** Normaliza in-place a `targetDb` dBFS de pico. Devuelve la ganancia aplicada. */
export function normalize(a: RenderedAudio, targetDb = -1): number {
  const pk = peakOf(a)
  if (pk < 1e-6) return 1
  const g = Math.pow(10, targetDb / 20) / pk
  for (let i = 0; i < a.left.length; i++) {
    a.left[i] *= g
    a.right[i] *= g
  }
  return g
}
