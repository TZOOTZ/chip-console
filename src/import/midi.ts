// ── Importar MIDI (SMF 0 y 1) → canción ──────────────────────────────────────
//
// Un MIDI trae cualquier cantidad de voces; la consola tiene cinco FM, tres cuadradas y una batería. Se hace así:
//   · el canal 10 (percusión GM) va al kit de batería de la canción;
//   · lo demás se separa en voces monofónicas (la nota nueva toma la voz libre de altura más cercana: un
//     acorde de tres notas son tres voces, una melodía es una) y se reparten por altura: la más grave al bajo
//     (FM1), la más aguda a la melodía (FM4), las del medio a FM2/FM3/FM5 y, si sobran, al PSG;
//   · el instrumento sale del programa GM de cada voz (piano, órgano, cuerdas, metales, saxo…);
//   · el tempo, el compás y la tonalidad salen del archivo; las notas se cuantizan a semicorcheas (o al
//     tresillo, si el archivo tiene swing), y el tema se trocea en patrones de 8 compases sin repetir los iguales.
import { FM, PSG } from '../music/genkit'
import { createEmptySong } from '../music/presets'
import { sanitizeSong, type Song } from '../music/song'
import { detectKey } from './key'
import { buildPatterns } from './patterns'

export interface ImportReport {
  title: string
  /** notas que han entrado en la canción */
  notes: number
  /** notas que no caben (más voces que canales, percusión sin equivalente) */
  dropped: number
  tracks: number
  warnings: string[]
  /** lo que se ha medido o decidido, sin ser un problema */
  info?: string[]
}

export interface ImportResult {
  song: Song
  report: ImportReport
}

// ── lector de archivos MIDI estándar ────────────────────────────────────────
interface RawNote {
  track: number
  ch: number
  tick: number
  end: number
  note: number
  vel: number
  prog: number
}

interface Parsed {
  ppq: number
  tempos: { tick: number; us: number }[]
  sigs: { tick: number; num: number; den: number }[]
  names: string[]
  notes: RawNote[]
  endTick: number
}

function parseSmf(b: Uint8Array): Parsed {
  const u32 = (o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  const u16 = (o: number): number => (b[o] << 8) | b[o + 1]
  const tag = (o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (b.length < 14 || tag(0) !== 'MThd') throw new Error('No es un archivo MIDI')
  const format = u16(8)
  const ntr = u16(10)
  const division = u16(12)
  if (format > 1) throw new Error('Formato MIDI 2 (varias canciones) no soportado')
  if (division & 0x8000) throw new Error('Tiempo SMPTE no soportado')
  const out: Parsed = { ppq: division || 480, tempos: [], sigs: [], names: [], notes: [], endTick: 0 }
  let p = 8 + u32(4)
  for (let t = 0; t < ntr && p + 8 <= b.length; t++) {
    if (tag(p) !== 'MTrk') break
    const end = Math.min(b.length, p + 8 + u32(p + 4))
    p += 8
    let tick = 0
    let run = 0
    const prog = new Array<number>(16).fill(0)
    const open = new Map<number, { tick: number; vel: number; prog: number }[]>()
    const close = (ch: number, note: number, at: number): void => {
      const q = open.get(ch * 128 + note)
      const o = q?.shift()
      if (o) out.notes.push({ track: t, ch, tick: o.tick, end: Math.max(o.tick + 1, at), note, vel: o.vel, prog: o.prog })
    }
    const vlq = (): number => {
      let v = 0
      for (let i = 0; i < 4 && p < end; i++) {
        const c = b[p++]
        v = (v << 7) | (c & 0x7f)
        if (!(c & 0x80)) break
      }
      return v
    }
    while (p < end) {
      tick += vlq()
      let st = b[p]
      if (st & 0x80) {
        p++
        run = st
      } else st = run
      if (st === 0xff) {
        const type = b[p++]
        const len = vlq()
        if (type === 0x51 && len === 3) out.tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] })
        else if (type === 0x58 && len >= 2) out.sigs.push({ tick, num: b[p], den: 2 ** b[p + 1] })
        else if (type === 0x03 && !out.names[t]) out.names[t] = String.fromCharCode(...b.subarray(p, p + len)).replace(/[^\x20-\x7e]/g, '').trim()
        p += len
      } else if (st === 0xf0 || st === 0xf7) {
        p += vlq()
      } else {
        const ch = st & 15
        const hi = st & 0xf0
        if (hi === 0x90 || hi === 0x80) {
          const note = b[p]
          const vel = b[p + 1]
          p += 2
          if (hi === 0x90 && vel > 0) {
            const k = ch * 128 + note
            const q = open.get(k) ?? []
            q.push({ tick, vel, prog: prog[ch] })
            open.set(k, q)
          } else close(ch, note, tick)
        } else if (hi === 0xc0) prog[ch] = b[p++]
        else if (hi === 0xd0) p += 1
        else p += 2
      }
    }
    // notas sin soltar: acaban con la pista
    for (const [k, q] of open) for (const o of q) out.notes.push({ track: t, ch: Math.floor(k / 128), tick: o.tick, end: Math.max(o.tick + 1, tick), note: k % 128, vel: o.vel, prog: o.prog })
    out.endTick = Math.max(out.endTick, tick)
    p = end
  }
  return out
}

// ── cuantización: semicorcheas, o la rejilla del swing (0, 1/3, 2/3, 5/6 de la negra) ──
const STRAIGHT = [0, 0.25, 0.5, 0.75, 1]
const SWUNG = [0, 1 / 3, 2 / 3, 5 / 6, 1]

function gridError(ticks: number[], ppq: number, grid: number[]): number {
  let e = 0
  for (const t of ticks) {
    const f = (t % ppq) / ppq
    let m = 1
    for (const g of grid) m = Math.min(m, Math.abs(f - g))
    e += m
  }
  return ticks.length ? e / ticks.length : 0
}

function quantizer(ppq: number, swung: boolean): (tick: number) => number {
  if (!swung) return (t) => Math.round((t * 4) / ppq)
  return (t) => {
    const beat = Math.floor(t / ppq)
    const f = (t - beat * ppq) / ppq
    let k = 0
    for (let i = 1; i < SWUNG.length; i++) if (Math.abs(f - SWUNG[i]) < Math.abs(f - SWUNG[k])) k = i
    return beat * 4 + k
  }
}

// ── instrumentos a partir del programa General MIDI ─────────────────────────
type Role = 'bass' | 'mid' | 'lead'

function gmFm(prog: number, role: Role): number {
  if (prog >= 32 && prog <= 39) return prog === 32 ? FM.WALK_BASS : prog === 36 || prog === 37 ? FM.SLAP : prog >= 38 ? FM.SEQ_BASS : FM.SUB
  const fam = prog >> 3
  // el bajo no puede ser un pad ni unas cuerdas: sin programa de bajo, un seno
  if (role === 'bass' && (prog === 0 || fam === 5 || fam === 6 || fam === 11)) return FM.SUB
  switch (fam) {
    case 0:
      return prog === 4 || prog === 5 ? FM.RHODES : prog === 6 || prog === 7 ? FM.PLUCK : FM.EPIANO
    case 1:
      return prog === 11 ? FM.VIBES : prog === 12 || prog === 13 ? FM.MALLET : prog === 15 ? FM.PLUCK : FM.BELL
    case 2:
      return FM.ORGAN
    case 3:
      return prog <= 25 ? FM.PLUCK : prog <= 29 ? FM.JAZZ_GUITAR : FM.SAW
    case 5:
      return prog === 45 || prog === 46 || prog === 47 ? FM.PLUCK : FM.STRINGS
    case 6:
      return prog >= 52 && prog <= 54 ? FM.CHOIR : prog === 55 ? FM.STAB : FM.STRINGS
    case 7:
      return FM.BRASS
    case 8:
      return FM.SAX
    case 9:
      return FM.FLUTE
    case 10:
      return prog === 80 ? FM.SQUARE : FM.SAW
    case 11:
      return FM.SOLINA
    case 12:
      return FM.DARK_PAD
    case 13:
      return FM.PLUCK
    case 14:
      return FM.MALLET
    default:
      return FM.BELL
  }
}

/** percusión GM → hueco del kit de fábrica (0 bombo · 1 caja · 2 charles · 3 abierto · 4 palmas · 5 tom grave · 6 tom agudo · 7 rim) */
const GM_DRUM: Record<number, number> = {
  35: 0, 36: 0, 37: 7, 38: 1, 39: 4, 40: 1, 41: 5, 42: 2, 43: 5, 44: 2, 45: 5, 46: 3, 47: 6, 48: 6, 49: 3, 50: 6,
  51: 2, 52: 3, 53: 2, 55: 3, 57: 3, 59: 2, 69: 2, 70: 2, 75: 7, 76: 7, 77: 7,
}

const toVel = (v: number): number => Math.max(1, Math.min(15, Math.round((v / 127) * 15)))

// ── voces ───────────────────────────────────────────────────────────────────
interface QNote {
  s: number
  e: number
  note: number
  vel: number
  prog: number
}

interface Lane {
  trackName: string
  notes: QNote[]
  mean: number
  prog: number
  /** duración mediana en pasos */
  len: number
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/** separa las notas de un canal en voces monofónicas: cada nota va a la voz libre de altura más cercana */
function splitLanes(notes: QNote[], trackName: string, limit: number): { lanes: Lane[]; dropped: number } {
  const lanes: QNote[][] = []
  let dropped = 0
  const sorted = [...notes].sort((a, b) => a.s - b.s || b.note - a.note)
  for (const n of sorted) {
    let best = -1
    let cost = Infinity
    lanes.forEach((l, i) => {
      const last = l[l.length - 1]
      // libre, o con un solape de un paso (legato) que se recorta
      if (last.e <= n.s || (last.s < n.s && last.e - n.s <= 1)) {
        const c = Math.abs(last.note - n.note)
        if (c < cost) {
          cost = c
          best = i
        }
      }
    })
    if (best >= 0) {
      const last = lanes[best][lanes[best].length - 1]
      last.e = Math.min(last.e, n.s)
      lanes[best].push({ ...n })
    } else if (lanes.length < limit) lanes.push([{ ...n }])
    else dropped++
  }
  const out = lanes.map((l) => {
    const progs = new Map<number, number>()
    for (const n of l) progs.set(n.prog, (progs.get(n.prog) ?? 0) + 1)
    const prog = [...progs.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return { trackName, notes: l, mean: l.reduce((a, n) => a + n.note, 0) / l.length, prog, len: median(l.map((n) => n.e - n.s)) }
  })
  return { lanes: out, dropped }
}

const FM_SLOTS = ['fm2', 'fm3', 'fm5']
const PSG_SLOTS = ['sq1', 'sq2', 'sq3']
const VOLS: Record<string, number> = { fm1: 96, fm2: 80, fm3: 80, fm5: 80, fm4: 92, ch6: 96, sq1: 70, sq2: 70, sq3: 70 }

/** reparte las voces por altura: la grave al bajo (FM1), la aguda a la melodía (FM4), las del medio a FM2/FM3/FM5 y, si sobran, al PSG */
function assignSlots(chosen: Lane[]): { slots: Map<string, Lane>; bassOk: boolean } {
  const slots = new Map<string, Lane>()
  const k = chosen.length
  const bassOk = k >= 2 && chosen[0].mean < 55
  if (k === 1) slots.set(chosen[0].mean < 50 ? 'fm1' : 'fm4', chosen[0])
  else if (k > 1) {
    if (bassOk) slots.set('fm1', chosen[0])
    slots.set('fm4', chosen[k - 1])
    const mids = chosen.slice(bassOk ? 1 : 0, k - 1)
    const fmMids = [...mids].sort((a, b) => b.notes.length - a.notes.length).slice(0, 3)
    fmMids.sort((a, b) => a.mean - b.mean).forEach((l, i) => slots.set(FM_SLOTS[i], l))
    mids.filter((l) => !fmMids.includes(l)).forEach((l, i) => slots.set(PSG_SLOTS[i], l))
  }
  return { slots, bassOk }
}

export function songFromMidi(bytes: Uint8Array, fileName = ''): ImportResult {
  const m = parseSmf(bytes)
  if (m.notes.length === 0) throw new Error('El MIDI no tiene notas')
  const warnings: string[] = []

  // ── tempo y compás ──
  const tempos = [...m.tempos].sort((a, b) => a.tick - b.tick)
  let bpm = Math.round(60_000_000 / (tempos[0]?.us ?? 500_000))
  while (bpm > 300) bpm = Math.round(bpm / 2)
  while (bpm < 30) bpm *= 2
  const distinct = new Set(tempos.map((t) => t.us)).size
  if (distinct > 1) warnings.push(`El MIDI cambia de tempo (${distinct} tempos): se usa el primero`)
  const sig = [...m.sigs].sort((a, b) => a.tick - b.tick)[0]
  let beatsPerBar = sig ? (sig.num * 16) / sig.den / 4 : 4
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 2 || beatsPerBar > 7) {
    warnings.push(`El compás ${sig?.num}/${sig?.den} no cabe en la rejilla: se usa 4/4`)
    beatsPerBar = 4
  }
  const spb = beatsPerBar * 4

  // ── rejilla: semicorcheas, o la del swing de tresillo si el archivo lo tiene ──
  const onsets = m.notes.map((n) => n.tick)
  const eStraight = gridError(onsets, m.ppq, STRAIGHT)
  const swung = onsets.length >= 16 && eStraight > 0.02 && gridError(onsets, m.ppq, SWUNG) < 0.7 * eStraight
  if (!swung && eStraight > 0.06) warnings.push('Muchas notas caen fuera de la rejilla de semicorcheas: se cuantizan a la más cercana')
  const q = quantizer(m.ppq, swung)

  // ── batería (canal 10) y voces melódicas ──
  const drums: { s: number; slot: number; vel: number }[] = []
  let dropped = 0
  const groups = new Map<string, RawNote[]>()
  for (const n of m.notes) {
    if (n.ch === 9) {
      const slot = GM_DRUM[n.note]
      if (slot === undefined) dropped++
      else drums.push({ s: q(n.tick), slot, vel: toVel(n.vel) })
    } else {
      const key = `${n.track}:${n.ch}`
      groups.set(key, [...(groups.get(key) ?? []), n])
    }
  }
  const all: Lane[] = []
  for (const [key, notes] of groups) {
    const qn = notes.map((n) => ({ s: q(n.tick), e: Math.max(q(n.tick) + 1, q(n.end)), note: n.note, vel: toVel(n.vel), prog: n.prog }))
    const r = splitLanes(qn, m.names[Number(key.split(':')[0])] ?? '', 8)
    all.push(...r.lanes)
    dropped += r.dropped
  }
  // más voces que canales: se quedan las que más suenan
  all.sort((a, b) => b.notes.length - a.notes.length)
  for (const l of all.slice(8)) dropped += l.notes.length
  if (all.length > 8) warnings.push(`El MIDI tiene ${all.length} voces y la consola ocho: se quedan las que más notas tienen`)
  const chosen = all.slice(0, 8).sort((a, b) => a.mean - b.mean)
  const { slots, bassOk } = assignSlots(chosen)
  const kept = chosen.reduce((n, l) => n + l.notes.length, 0) + drums.length

  // ── cabecera de la canción ──
  const song = createEmptySong()
  song.title = (m.names[0] || fileName.replace(/\.[^.]*$/, '') || 'MIDI IMPORTADO').slice(0, 40)
  song.bpm = bpm
  song.beatsPerBar = beatsPerBar
  song.swing = swung ? 1 / 3 : 0
  song.swingGrid = swung ? 4 : 2
  const weights = new Array<number>(12).fill(0)
  for (const n of m.notes) if (n.ch !== 9) weights[n.note % 12] += n.end - n.tick
  const tonal = detectKey(weights)
  song.key = tonal.key
  song.scale = tonal.minor ? 'minor' : 'major'
  for (const t of song.tracks) {
    t.vol = VOLS[t.id] ?? t.vol
    const lane = slots.get(t.id)
    if (!lane) continue
    if (t.kind === 'fm') {
      t.inst = gmFm(lane.prog, t.id === 'fm1' && bassOk ? 'bass' : t.id === 'fm4' ? 'lead' : 'mid')
      t.name = (lane.trackName || song.fmBank[t.inst].name).toUpperCase().slice(0, 12)
    } else if (t.kind === 'psg') {
      t.inst = lane.len >= 8 ? PSG.PAD : lane.len >= 3 ? PSG.LEAD : PSG.PLUCK
      t.name = (lane.trackName || song.psgBank[t.inst].name).toUpperCase().slice(0, 12)
    }
  }
  if (drums.length) song.tracks.find((t) => t.id === 'ch6')!.name = 'DRUMS GM'
  const lastStep = Math.max(1, ...chosen.flatMap((l) => l.notes.map((n) => n.e)), ...drums.map((d) => d.s + 1))
  buildPatterns(song, slots, drums, Math.max(1, Math.ceil(lastStep / spb)), warnings)
  return { song: sanitizeSong(JSON.parse(JSON.stringify(song)), createEmptySong()), report: { title: song.title, notes: kept, dropped, tracks: slots.size + (drums.length ? 1 : 0), warnings } }
}
