// ── Importar VGM (YM2612 + SN76489) → canción ──────────────────────────────────────
//
// Un VGM es el registro de escrituras al chip, sin partitura. Se reconstruye así:
//   · cada canal FM del YM2612 es una pista (FM1-FM5 y el sexto, o el DAC si el VGM lo usa); su parche sale de los
//     registros en el key-on (operadores, algoritmo, realimentación, panorama) y se añade al banco FM de la canción;
//     la dinámica sale del volumen de las portadoras (TL), con el más fuerte del canal como velocidad 15;
//   · las tres cuadradas y el ruido del SN76489 son SQ1-SQ3 y la pista de ruido (la velocidad sale del volumen);
//   · los golpes del DAC se recortan como muestras de PCM de 8 bits y forman el kit de batería (los ocho que más suenan);
//   · el tempo se mide buscando la rejilla de semicorcheas que mejor encaja con los inicios de nota, con swing si lo
//     hay; si el VGM tiene bucle, el compás 1 se alinea para que la canción vuelva a empezar donde él vuelve.
// Lo que no cabe en el modelo se pierde con aviso: vibratos y barridos de tono, SSG-EG, el modo de tres frecuencias
// del canal 3, los cambios de parche dentro de un canal, los demás chips y los cambios de tempo.
import { toBase64 } from '../engine/drums'
import { PSG } from '../music/genkit'
import { createEmptySong } from '../music/presets'
import { sanitizeSong, type DrumVoice, type FmOp, type FmPatch } from '../music/song'
import { estimateGrid, stepOf } from './grid'
import { detectKey } from './key'
import type { ImportResult } from './midi'
import { buildPatterns, type DrumHit, type StepNote } from './patterns'
import { trackPsg } from './psgTrack'
import { parseVgm } from './vgmParse'
import { CARRIER_OPS, trackYm, type DacHit, type FmVoiceNote } from './ymTrack'

const SR = 44100
const FM_TRACKS = ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'ch6']
const PSG_TRACKS = ['sq1', 'sq2', 'sq3']

/** dos notas con el mismo timbre (con los TL de las portadoras aparte, que son volumen, y los de los moduladores por tramos de 6 dB) */
function signature(n: FmVoiceNote): string {
  const s = n.snap
  const car = CARRIER_OPS[s.alg]
  const ops = s.ops.map((o, i) => [o.dt, o.mul, car[i] ? 0 : o.tl >> 3, o.rs, o.ar, o.am, o.d1r, o.d2r, o.sl, o.rr].join(','))
  return [s.alg, s.fb, s.ams, s.pms, ...ops].join('|')
}

/** el parche de la nota más fuerte del timbre principal, con las portadoras bajadas hasta el nivel de referencia del canal */
function patchFrom(rep: FmVoiceNote, tlRef: number, name: string): FmPatch {
  const s = rep.snap
  const car = CARRIER_OPS[s.alg]
  const shift = rep.carTl - tlRef
  const ops = s.ops.map(
    (o, i): FmOp => ({ mul: o.mul, dt: o.dt, tl: car[i] ? Math.max(0, o.tl - shift) : o.tl, rs: o.rs, ar: o.ar, d1r: o.d1r, sl: o.sl, d2r: o.d2r, rr: o.rr, am: o.am }),
  )
  return { name, alg: s.alg, fb: s.fb, ops: ops as FmPatch['ops'], ams: s.ams, pms: s.pms }
}

/** cada nota acaba donde empieza la siguiente de otro paso (las del mismo paso son un acorde en una pista) */
function tidy(notes: StepNote[]): StepNote[] {
  notes.sort((a, b) => a.s - b.s || a.note - b.note)
  for (let i = 0; i < notes.length; i++) {
    let j = i + 1
    while (j < notes.length && notes[j].s === notes[i].s) j++
    if (j < notes.length && notes[i].e > notes[j].s) notes[i].e = notes[j].s
  }
  return notes
}

/** la firma de un golpe de DAC: su largo y sus primeras muestras (sin el ruido del bit bajo) */
const hitKey = (h: DacHit): string => {
  if (h.key) return h.key
  let acc = 0
  for (let i = 0; i < Math.min(h.pcm.length, 256); i++) acc = (Math.imul(acc, 31) + (h.pcm[i] >> 2)) | 0
  return `${Math.round(h.pcm.length / 16)}:${acc}`
}

export function songFromVgm(bytes: Uint8Array, fileName = ''): ImportResult {
  const tl = parseVgm(bytes)
  const warnings = [...tl.warnings]
  const ym = trackYm(tl.ym, tl.ymClock || 7_670_454)
  warnings.push(...ym.warnings)
  const psg = trackPsg(tl.psg, tl.snClock || 3_579_545)
  const useDac = ym.dacOn && ym.hits.length > 0
  let dropped = 0

  // ── la rejilla de tiempo, medida con todos los inicios de nota ──
  const onsets: number[] = []
  for (const n of ym.notes) if (!(n.ch === 5 && useDac)) for (const p of n.parts) onsets.push(p.t0 / SR)
  for (const n of psg.notes) for (const p of n.parts) onsets.push(p.t0 / SR)
  for (const n of psg.noise) onsets.push(n.t0 / SR)
  if (useDac) for (const h of ym.hits) onsets.push(h.t0 / SR)
  if (onsets.length === 0) throw new Error('El VGM no tiene notas del YM2612 ni del SN76489')
  const grid = estimateGrid(onsets)
  if (grid.score < 0.45) warnings.push('El tempo del VGM no es regular (o no se ha podido medir): las notas se cuantizan sin mucha seguridad')
  const qs = (t: number): number => stepOf(grid, t / SR)
  const bpm = Math.max(30, Math.min(300, Math.round(grid.bpm)))

  const song = createEmptySong()
  const voices = new Map<string, { notes: StepNote[] }>()
  const weights = new Array<number>(12).fill(0)
  const track = (id: string) => song.tracks.find((t) => t.id === id)!

  // ── FM ──
  FM_TRACKS.forEach((id, ch) => {
    const list = ym.notes.filter((n) => n.ch === ch)
    if (list.length === 0) return
    if (ch === 5 && useDac) {
      dropped += list.length
      warnings.push('El sexto canal del VGM es el DAC: sus notas FM se descartan')
      return
    }
    const tlRef = Math.min(...list.map((n) => n.carTl))
    const groups = new Map<string, FmVoiceNote[]>()
    for (const n of list) groups.set(signature(n), [...(groups.get(signature(n)) ?? []), n])
    const main = [...groups.values()].sort((a, b) => b.length - a.length)[0]
    if (groups.size > 1) warnings.push(`El canal ${id.toUpperCase()} cambia de parche ${groups.size - 1} veces: se usa el principal`)
    const rep = main.reduce((a, b) => (b.carTl < a.carTl ? b : a))
    const t = track(id)
    if (song.fmBank.length < 64) {
      t.inst = song.fmBank.length
      song.fmBank.push(patchFrom(rep, tlRef, `VGM FM${ch + 1}`))
    } else warnings.push('El banco FM está lleno: el canal usa el primer parche')
    t.kind = 'fm'
    t.name = `FM${ch + 1}`
    t.pan = rep.snap.pan === 2 ? 'L' : rep.snap.pan === 1 ? 'R' : 'C'
    t.gate = 1
    const notes: StepNote[] = []
    for (const n of list) {
      // el volumen del canal baja en pasos de 0,75 dB por TL: la velocidad es esa atenuación respecto al más fuerte
      const vel = Math.max(1, Math.min(15, Math.round(15 * Math.pow(10, (-0.75 * (n.carTl - tlRef)) / 20))))
      for (const p of n.parts) {
        const s = qs(p.t0)
        notes.push({ s, e: Math.max(s + 1, qs(p.t1)), note: p.note, vel, slide: p.slide })
        weights[p.note % 12] += p.t1 - p.t0
      }
    }
    voices.set(id, { notes: tidy(notes) })
  })

  // ── PSG: tres cuadradas y ruido ──
  PSG_TRACKS.forEach((id, ch) => {
    const list = psg.notes.filter((n) => n.ch === ch)
    if (list.length === 0) return
    const t = track(id)
    t.inst = list.reduce((n, x) => n + x.decay, 0) / list.length >= 4 ? PSG.PLUCK : PSG.LEAD
    t.gate = 1
    const notes: StepNote[] = []
    for (const n of list) {
      for (const p of n.parts) {
        const s = qs(p.t0)
        notes.push({ s, e: Math.max(s + 1, qs(p.t1)), note: p.note, vel: n.vel, slide: p.slide })
        weights[p.note % 12] += p.t1 - p.t0
      }
    }
    voices.set(id, { notes: tidy(notes) })
  })
  if (psg.noise.length) {
    // blanco de frecuencia alta = charles (abierto si es largo) · blanco medio = caja · blanco grave = caja grave · periódico = zumbido o rumor
    const notes: StepNote[] = psg.noise.map((n) => {
      const s = qs(n.t0)
      const e = Math.max(s + 1, qs(n.t1))
      const note = n.white ? (n.rate === 0 ? (e - s >= 4 ? 1 : 0) : n.rate === 1 ? 2 : 3) : n.rate <= 1 ? 4 : 5
      return { s, e, note, vel: n.vel }
    })
    voices.set('noise', { notes: tidy(notes) })
  }

  // ── DAC: los golpes se vuelven muestras del kit ──
  const drums: DrumHit[] = []
  if (useDac) {
    const groups = new Map<string, DacHit[]>()
    for (const h of ym.hits) groups.set(hitKey(h), [...(groups.get(hitKey(h)) ?? []), h])
    const top = [...groups.values()].sort((a, b) => b.length - a.length).slice(0, 8)
    if (groups.size > 8) warnings.push(`El DAC del VGM tiene ${groups.size} sonidos y el kit ocho: se quedan los que más suenan`)
    song.drumKit = top.map(
      (g, i): DrumVoice => ({ name: `PCM ${i + 1}`, kind: 'sample', pitch: 0.5, decay: 0.5, tone: 0.5, gain: 0.9, pcm: toBase64(g[0].pcm), rate: g[0].rate }),
    )
    top.forEach((g, i) => {
      for (const h of g) drums.push({ s: qs(h.t0), slot: i, vel: 15 })
    })
    dropped += ym.hits.length - top.reduce((n, g) => n + g.length, 0)
    if (ym.hits.some((h) => h.pcm.length >= 24000)) warnings.push('Algún golpe del DAC es muy largo: se recorta a 24 KB')
  }

  // ── compás 1: el bucle del VGM (o el primer golpe) cae en un inicio de compás ──
  const spb = 16
  const all = [...voices.values()].flatMap((v) => v.notes)
  const firstStep = Math.min(...all.map((n) => n.s), ...drums.map((d) => d.s))
  const loopStep = tl.loopAt >= 0 ? qs(tl.loopAt) : -1
  let shift = loopStep >= 0 ? ((loopStep % spb) + spb) % spb : firstStep
  // nada antes del paso 0: si hace falta, se añaden compases de silencio al principio
  if (firstStep - shift < 0) shift -= Math.ceil((shift - firstStep) / spb) * spb
  for (const n of all) {
    n.s -= shift
    n.e -= shift
  }
  for (const d of drums) d.s -= shift
  // la cola de las últimas notas (el chip las apaga tras el final) no abre un compás más
  const lastStep = Math.max(1, ...all.map((n) => n.s + 1), ...drums.map((d) => d.s + 1))

  // ── la canción ──
  song.title = (tl.title || fileName.replace(/\.[^.]*$/, '') || 'VGM IMPORTADO').slice(0, 40)
  song.author = tl.author.slice(0, 40)
  song.bpm = bpm
  song.beatsPerBar = 4
  song.swing = grid.swung ? 1 / 3 : 0
  song.swingGrid = grid.swung ? 4 : 2
  song.lfo = ym.lfo
  const tonal = detectKey(weights)
  song.key = tonal.key
  song.scale = tonal.minor ? 'minor' : 'major'
  if (useDac) track('ch6').name = 'DRUMS PCM'
  buildPatterns(song, voices, drums, Math.max(1, Math.ceil(lastStep / spb)), warnings, { loopBar: loopStep >= 0 ? (loopStep - shift) / spb : -1, chunks: [8, 4, 2, 1, 16, 32] })
  const kept = all.length + drums.length
  const tracks = voices.size + (drums.length ? 1 : 0)
  const info = [`Tempo medido: ${grid.bpm.toFixed(2)} BPM${grid.swung ? ' con swing' : ''}${bpm !== grid.bpm ? ` (la canción lleva ${bpm})` : ''}`]
  return { song: sanitizeSong(JSON.parse(JSON.stringify(song)), createEmptySong()), report: { title: song.title, notes: kept, dropped, tracks, warnings, info } }
}
