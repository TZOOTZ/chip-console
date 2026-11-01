// ── Exportador MIDI estándar (SMF formato 1) ────────────────────────────────
//
// Una pista MIDI por pista de la canción que suena (MUTE y SOLO cuentan, como en la reproducción),
// más la pista de tempo. La batería (DAC + ruido) va al canal 10 con el mapa de percusión GM.
import { isTrackAudible } from '../engine/synth'
import { songSteps, stepsPerBar, getPattern, type DrumKind, type Song } from '../music/song'

const PPQ = 480

/** sonido de batería de la consola → nota GM, según el tipo de sonido que haya en el kit */
const KIND_GM: Record<DrumKind, number> = { kick: 36, snare: 38, hat: 42, ohat: 46, clap: 39, tom: 45, rim: 37, cow: 56, zap: 50, timp: 43, crash: 49, sample: 39 }
function dacGm(song: Song, idx: number): number {
  const v = song.drumKit[idx]
  if (!v) return 36
  if (v.kind === 'tom') return v.pitch < 0.4 ? 41 : 45
  if (v.kind === 'zap') return v.pitch < 0.35 ? 47 : 50
  // timbales: el más agudo del kit al tom de suelo alto y los demás al grave
  if (v.kind === 'timp') return song.drumKit.some((o) => o.kind === 'timp' && o.pitch > v.pitch) ? 41 : 43
  return KIND_GM[v.kind]
}
const NOISE_GM = [42, 46, 38, 40, 70, 35]

class Bytes {
  data: number[] = []
  u8(v: number) {
    this.data.push(v & 0xff)
  }
  u16(v: number) {
    this.u8(v >> 8)
    this.u8(v)
  }
  u32(v: number) {
    this.u16(v >>> 16)
    this.u16(v & 0xffff)
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7f)
  }
  vlq(v: number) {
    let b = v & 0x7f
    const stack: number[] = []
    while ((v >>= 7) > 0) {
      stack.push(b)
      b = (v & 0x7f) | 0x80
    }
    this.u8(b)
    for (let i = stack.length - 1; i >= 0; i--) this.u8(stack[i])
  }
}

interface Ev {
  tick: number
  order: number
  bytes: number[]
}

function chunk(tag: string, body: number[]): number[] {
  const b = new Bytes()
  b.str(tag)
  b.u32(body.length)
  return [...b.data, ...body]
}

function buildTrack(name: string, events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const b = new Bytes()
  // nombre de pista
  b.vlq(0)
  b.u8(0xff)
  b.u8(0x03)
  const nm = name.slice(0, 40)
  b.vlq(nm.length)
  b.str(nm)
  let last = 0
  for (const e of events) {
    b.vlq(Math.max(0, e.tick - last))
    last = e.tick
    for (const x of e.bytes) b.u8(x)
  }
  b.vlq(0)
  b.u8(0xff)
  b.u8(0x2f)
  b.u8(0x00)
  return chunk('MTrk', b.data)
}

/**
 * Posición en ticks de un paso con el swing de la canción metido (lo que se oye): en cada celda de swing la primera
 * mitad dura (1 + swing) pasos y la segunda (1 − swing). Con `straight` los pasos quedan en la rejilla recta.
 */
export function stepTick(song: Pick<Song, 'swing' | 'swingGrid'>, step: number, straight = false): number {
  const g = song.swingGrid === 4 ? 4 : 2
  const p = step - Math.floor(step / g) * g
  const off = straight ? 0 : p <= g / 2 ? p * song.swing : song.swing * (g - p)
  return Math.round((step + off) * (PPQ / 4))
}

export function buildMidi(song: Song, opts: { straight?: boolean } = {}): Uint8Array {
  const spb = stepsPerBar(song)
  const tickPerStep = PPQ / 4
  // posición absoluta de inicio de cada patrón en el orden
  const starts: { id: string; start: number }[] = []
  let acc = 0
  for (const id of song.order) {
    const p = getPattern(song, id)
    if (!p) continue
    starts.push({ id, start: acc })
    acc += p.bars * spb
  }

  const tracks: number[][] = []

  // pista 0: tempo y compás
  {
    const ev: Ev[] = []
    const mpqn = Math.round(60_000_000 / song.bpm)
    ev.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff] })
    const den = 2 // 2^2 = 4
    ev.push({ tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, song.beatsPerBar, den, 24, 8] })
    // marcadores de sección
    for (const s of starts) {
      const p = getPattern(song, s.id)
      if (!p) continue
      const nm = `PAT ${p.name}`
      ev.push({ tick: s.start * tickPerStep, order: 2, bytes: [0xff, 0x06, nm.length, ...[...nm].map((c) => c.charCodeAt(0) & 0x7f)] })
    }
    // fin de canción (para que los DAW conozcan la longitud)
    ev.push({ tick: songSteps(song) * tickPerStep, order: 9, bytes: [] })
    ev.pop()
    tracks.push(buildTrack(song.title || 'TZ MEGADRIVE', ev))
  }

  const channelFor = (idx: number, kind: string): number => {
    if (kind === 'dac' || kind === 'noise') return 9
    // canales 0-8 repartidos saltando el 9 (percusión)
    return idx > 8 ? 8 : idx
  }

  song.tracks.forEach((tr, idx) => {
    if (!isTrackAudible(song, idx)) return
    const ch = channelFor(idx, tr.kind)
    const ev: Ev[] = []
    for (const s of starts) {
      const p = getPattern(song, s.id)
      if (!p) continue
      for (const n of p.notes[tr.id] ?? []) {
        let note = n.note + tr.transpose
        if (tr.kind === 'dac') note = dacGm(song, n.note)
        else if (tr.kind === 'noise') note = NOISE_GM[n.note] ?? 42
        note = Math.max(0, Math.min(127, note))
        const vel = Math.max(1, Math.min(127, Math.round((n.vel / 15) * 127 * (tr.vol / 100))))
        const at = s.start + n.step
        const t0 = stepTick(song, at, opts.straight)
        const len = tr.kind === 'dac' || tr.kind === 'noise' ? 1 : n.len
        const t1 = t0 + Math.max(1, Math.round((stepTick(song, at + len, opts.straight) - t0) * tr.gate))
        ev.push({ tick: t0, order: 5, bytes: [0x90 | ch, note, vel] })
        ev.push({ tick: t1, order: 3, bytes: [0x80 | ch, note, 0] })
      }
    }
    if (ev.length === 0) return
    const label =
      tr.kind === 'fm'
        ? song.fmBank[tr.inst]?.name
        : tr.kind === 'psg'
          ? song.psgBank[tr.inst]?.name
          : tr.kind === 'dac'
            ? 'DRUMS'
            : 'NOISE'
    tracks.push(buildTrack(`${tr.id.toUpperCase()} ${tr.name} · ${label ?? ''}`, ev))
  })

  const head = new Bytes()
  head.u16(1)
  head.u16(tracks.length)
  head.u16(PPQ)
  const out: number[] = [...chunk('MThd', head.data)]
  for (const t of tracks) out.push(...t)
  return new Uint8Array(out)
}
