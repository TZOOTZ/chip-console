// ── De notas sueltas a patrones (compartido por los importadores de MIDI y de VGM) ───
//
// El tema se trocea en patrones de 8 compases (16 o 32 si no caben en los 36 patrones y 128 bloques que admite
// una canción), y un trozo que repite exacto otro reutiliza su patrón: así un estribillo repetido es un solo
// patrón en el orden, como lo habría escrito alguien a mano.
import { tunePsg } from '../music/genkit'
import { MAX_BARS, MAX_ORDER, MAX_PATTERNS, emptyPattern, type Note, type Song } from '../music/song'

export interface StepNote {
  /** paso de inicio y de fin (exclusivo) en la rejilla de semicorcheas de la canción */
  s: number
  e: number
  note: number
  vel: number
  /** nota ligada a la anterior (sin re-ataque) */
  slide?: boolean
}

export interface DrumHit {
  s: number
  /** hueco del kit de batería */
  slot: number
  vel: number
}

/** Rellena `song.patterns` y `song.order`; `voices` va por id de pista y `drums` a la pista del DAC (ch6). */
export interface CutOptions {
  /** tamaños de patrón (compases) a probar, por orden de preferencia */
  chunks?: number[]
  /** compás en que empieza el bucle de la canción (-1 o sin dar = sin bucle) */
  loopBar?: number
}

export function buildPatterns(song: Song, voices: Map<string, { notes: StepNote[] }>, drums: DrumHit[], totalBars: number, warnings: string[], opts: CutOptions = {}): void {
  const spb = song.beatsPerBar * 4
  const placed = (c0: number, c1: number): Record<string, Note[]> => {
    const notes: Record<string, Note[]> = {}
    for (const [id, voice] of voices) {
      const tr = song.tracks.find((t) => t.id === id)
      if (!tr) continue
      const out: Note[] = []
      const seen = new Set<string>()
      for (const n of voice.notes) {
        if (n.s < c0 || n.s >= c1) continue
        let note = n.note
        if (tr.kind === 'fm' || tr.kind === 'psg') {
          while (note < 24) note += 12
          while (note > 108) note -= 12
        }
        const key = `${n.s}:${note}`
        if (seen.has(key)) continue
        seen.add(key)
        const nn: Note = { step: n.s - c0, len: Math.max(1, Math.min(n.e, c1) - n.s), note, vel: n.vel }
        if (n.slide && n.s > c0) nn.slide = true
        out.push(nn)
      }
      out.sort((a, b) => a.step - b.step || a.note - b.note)
      if (tr.kind === 'psg') tunePsg(out, tr.transpose)
      notes[id] = out
    }
    const dr: Note[] = []
    const seen = new Set<string>()
    for (const d of drums) {
      const key = `${d.s}:${d.slot}`
      if (d.s < c0 || d.s >= c1 || seen.has(key)) continue
      seen.add(key)
      dr.push({ step: d.s - c0, len: 1, note: d.slot, vel: d.vel })
    }
    // el canal 6 es el DAC salvo que un importador lo use como sexto canal FM
    if (!voices.has('ch6')) notes.ch6 = dr.sort((a, b) => a.step - b.step || a.note - b.note)
    return notes
  }

  let patterns: Song['patterns'] = []
  let order: string[] = []
  const loopBar = opts.loopBar ?? -1
  let chunks = opts.chunks ?? [8, 16, MAX_BARS]
  // el bucle ha de caer en el inicio de un patrón: se prueban los tamaños que lo permiten
  if (loopBar > 0) {
    const fit = chunks.filter((c) => loopBar % c === 0)
    if (fit.length) chunks = fit
    else warnings.push('El bucle del VGM no empieza en un compás redondo: la canción no lo conserva')
  }
  let used = chunks[0]
  for (const chunk of chunks) {
    used = chunk
    song.patterns = []
    order = []
    const byKey = new Map<string, string>()
    for (let b0 = 0; b0 < totalBars; b0 += chunk) {
      const bars = Math.min(chunk, totalBars - b0)
      const notes = placed(b0 * spb, (b0 + bars) * spb)
      const key = JSON.stringify([bars, notes])
      let id = byKey.get(key)
      if (!id) {
        const p = emptyPattern(song, bars)
        for (const t of song.tracks) p.notes[t.id] = notes[t.id] ?? []
        song.patterns.push(p)
        id = p.id
        byKey.set(key, id)
      }
      order.push(id)
    }
    patterns = song.patterns
    if (patterns.length <= MAX_PATTERNS && order.length <= MAX_ORDER) break
  }
  if (patterns.length > MAX_PATTERNS || order.length > MAX_ORDER) warnings.push(`El tema es larguísimo: solo caben los primeros ${MAX_ORDER} bloques y ${MAX_PATTERNS} patrones`)
  song.patterns = patterns.slice(0, MAX_PATTERNS)
  const ids = new Set(song.patterns.map((p) => p.id))
  song.order = order.filter((id) => ids.has(id)).slice(0, MAX_ORDER)
  if (song.order.length === 0) song.order = [song.patterns[0].id]
  song.loopStart = loopBar >= 0 && loopBar % used === 0 ? Math.min(song.order.length - 1, loopBar / used) : -1
}
