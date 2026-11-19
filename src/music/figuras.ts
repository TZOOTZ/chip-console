// ── FIGURAS: recursos de composición sobre la pista y la selección ───────────
//
// Retórica (gradatio, anáfora, secuencia, ostinato), adorno (retardo, melisma, mordente), textura
// (unísono, tríada, cuatríada, cluster) y articulación (legato, staccato, rubato). Cada figura
// trabaja sobre las notas seleccionadas de la pista o, si no hay selección, sobre lo que tiene
// sentido para ella (el primer compás con notas como motivo, todas las notas para articular).
// Todo se mueve por grados de la escala del tema: la secuencia baja un grado y no un semitono.
import { getPattern, patternSteps, stepsPerBar, type Note, type Song, type Track } from './song'
import { CHORDS, diatonicChord, scaleById, type ChordType } from './theory'

export type FigureId = 'gradatio' | 'anafora' | 'secuencia' | 'ostinato' | 'retardo' | 'melisma' | 'mordente' | 'unisono' | 'triada' | 'cuatriada' | 'cluster' | 'legato' | 'staccato' | 'rubato'
export type FigureGroup = 'RETÓRICA' | 'ADORNO' | 'TEXTURA' | 'ARTICULACIÓN'

export interface FigureInfo {
  id: FigureId
  name: string
  group: FigureGroup
  blurb: string
  /** también sirve en pistas de batería */
  drums?: boolean
}

export const FIGURES: FigureInfo[] = [
  { id: 'gradatio', name: 'GRADATIO', group: 'RETÓRICA', blurb: 'Clímax: el motivo se repite tres veces, cada vez un grado más arriba y un poco más fuerte' },
  { id: 'anafora', name: 'ANÁFORA', group: 'RETÓRICA', blurb: 'La cabeza del motivo vuelve, idéntica, al empezar cada frase', drums: true },
  { id: 'secuencia', name: 'SECUENCIA', group: 'RETÓRICA', blurb: 'Secuencia armónica: el motivo y todas las voces que suenan con él bajan un grado tres veces seguidas' },
  { id: 'ostinato', name: 'OSTINATO', group: 'RETÓRICA', blurb: 'El motivo se repite igual hasta el final del patrón, pase lo que pase por encima', drums: true },
  { id: 'retardo', name: 'RETARDO', group: 'ADORNO', blurb: 'La nota llega tarde: suena antes la de un grado por encima y resuelve bajando (4–3, 9–8). Sin selección, en las notas que empiezan compás' },
  { id: 'melisma', name: 'MELISMA', group: 'ADORNO', blurb: 'Las notas largas se convierten en un adorno que gira y corre por grados hasta la nota siguiente. Sin selección, las de seis pasos o más' },
  { id: 'mordente', name: 'MORDENTE', group: 'ADORNO', blurb: 'Nota, la de debajo y vuelta, sin volver a atacar. Sin selección, en las notas de un tiempo o más que caen en tiempo' },
  { id: 'unisono', name: 'UNÍSONO', group: 'TEXTURA', blurb: 'Dobla la línea a la misma altura en otra pista libre: el FM con un canal del PSG, o al revés' },
  { id: 'triada', name: 'TRÍADA', group: 'TEXTURA', blurb: 'Armoniza la melodía con acordes de tres notas por debajo, uno por medio compás, en las pistas libres' },
  { id: 'cuatriada', name: 'CUATRÍADA', group: 'TEXTURA', blurb: 'Lo mismo con acordes de séptima: cuatro voces' },
  { id: 'cluster', name: 'CLUSTER', group: 'TEXTURA', blurb: 'Racimo de segundas pegadas por debajo de la melodía: tensión, misterio, terror' },
  { id: 'legato', name: 'LEGATO', group: 'ARTICULACIÓN', blurb: 'Cada nota dura hasta la siguiente y se liga, sin volver a atacar. El GLIDE de la pista decide si resbala' },
  { id: 'staccato', name: 'STACCATO', group: 'ARTICULACIÓN', blurb: 'Notas a la mitad, picadas. Las de un paso ya no pueden ser más cortas: para eso, baja el GATE' },
  { id: 'rubato', name: 'RUBATO', group: 'ARTICULACIÓN', blurb: 'En cada compás, la nota más alta se estira un paso y la siguiente lo devuelve; el acompañamiento sigue a tempo' },
]

export interface FigureResult {
  ok: boolean
  message: string
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12
const isDrum = (t: Track): boolean => t.kind === 'dac' || t.kind === 'noise'
const byStep = (a: Note, b: Note): number => a.step - b.step || a.note - b.note

// ── la escala del tema ──────────────────────────────────────────────────────
/** pitch classes absolutas de la escala; las pentatónicas y el blues se mueven por su escala de siete */
export function scalePcs(song: Pick<Song, 'key' | 'scale'>): number[] {
  let steps = scaleById(song.scale).steps
  if (steps.length < 7) steps = scaleById(steps.includes(3) ? 'minor' : 'major').steps
  return steps.map((s) => mod12(s + song.key))
}

/** `k` grados de la escala arriba (o abajo); una nota fuera de la escala se mueve con su alteración */
export function stepDia(pcs: number[], midi: number, k: number): number {
  if (!pcs.includes(mod12(midi))) {
    let m0 = midi - 1
    while (!pcs.includes(mod12(m0)) && m0 > midi - 12) m0--
    return stepDia(pcs, m0, k) + (midi - m0)
  }
  let m = midi
  const dir = Math.sign(k)
  for (let i = 0; i < Math.abs(k); i++) {
    m += dir
    while (!pcs.includes(mod12(m))) m += dir
  }
  return m
}

/** grados de la escala entre dos notas (con signo) */
function diaDistance(pcs: number[], a: number, b: number): number {
  let d = 0
  const dir = Math.sign(b - a)
  for (let m = a; dir > 0 ? m < b : m > b; m += dir) if (pcs.includes(mod12(m + dir))) d += dir
  return d
}

// ── el motivo ───────────────────────────────────────────────────────────────
interface Motif {
  notes: Note[]
  start: number
  span: number
}

const beatFloor = (s: number): number => Math.floor(s / 4) * 4
const beatCeil = (s: number): number => Math.ceil(s / 4) * 4

/** la selección (redondeada a tiempos) o, sin selección, el primer compás con notas */
function motifOf(notes: Note[], sel: Note[], spb: number): Motif | null {
  if (sel.length) {
    const start = beatFloor(Math.min(...sel.map((n) => n.step)))
    const end = beatCeil(Math.max(...sel.map((n) => n.step + n.len)))
    return { notes: sel, start, span: Math.max(4, end - start) }
  }
  if (!notes.length) return null
  const bar = Math.floor(notes[0].step / spb)
  const start = bar * spb
  return { notes: notes.filter((n) => n.step >= start && n.step < start + spb), start, span: spb }
}

/** quita de la pista las notas que empiezan en [from, to) */
function clearRange(arr: Note[], from: number, to: number): void {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].step >= from && arr[i].step < to) arr.splice(i, 1)
}

/** copia del motivo desplazada `shift` pasos y movida `k` grados (recortada al final del patrón) */
function copyMotif(m: Motif, shift: number, k: number, pcs: number[], max: number, velDelta = 0, transpose = true): Note[] {
  const out: Note[] = []
  for (const n of m.notes) {
    const step = n.step + shift
    if (step >= max) continue
    out.push({ ...n, step, len: Math.min(n.len, max - step), note: transpose && k ? stepDia(pcs, n.note, k) : n.note, vel: Math.max(1, Math.min(15, n.vel + velDelta)) })
  }
  return out
}

// ── adornos sobre una lista de notas (también los usan las piezas) ──────────
/** mordente: nota, la de debajo (de la escala) y vuelta, sin re-atacar; solo en notas de tres pasos o más */
export function mordent(notes: Note[], pick: (n: Note) => boolean, pcs: number[]): Note[] {
  const out: Note[] = []
  for (const n of notes) {
    if (!pick(n) || n.len < 3) {
      out.push(n)
      continue
    }
    const lower = stepDia(pcs, n.note, -1)
    out.push({ ...n, len: 1 })
    out.push({ step: n.step + 1, len: 1, note: lower, vel: Math.max(1, n.vel - 2), slide: true })
    out.push({ step: n.step + 2, len: n.len - 2, note: n.note, vel: Math.max(1, n.vel - 1), slide: true })
  }
  return out
}

/** melisma: la nota larga se vuelve un giro y una carrera por grados que llega a la nota siguiente por grado */
export function melisma(n: Note, goal: number | null, pcs: number[]): Note[] {
  const runLen = Math.min(n.len, 8)
  const head = n.len - runLen + 1
  const target = goal ?? n.note
  const last = target === n.note ? stepDia(pcs, n.note, 1) : stepDia(pcs, target, target > n.note ? -1 : 1)
  const dist = diaDistance(pcs, n.note, last)
  const slots = runLen - 1
  const path: number[] = []
  // primero el giro alrededor de la nota (arriba, nota, abajo, nota…) con lo que sobre; luego la carrera
  const spare = Math.max(0, slots - Math.abs(dist))
  const turn = [1, 0, -1, 0]
  for (let i = 0; i < spare; i++) path.push(stepDia(pcs, n.note, turn[i % 4]))
  const dir = Math.sign(dist)
  for (let i = 1; path.length < slots; i++) path.push(stepDia(pcs, n.note, dir * Math.min(i, Math.abs(dist))))
  const out: Note[] = [{ ...n, len: head }]
  path.forEach((note, i) => out.push({ step: n.step + head + i, len: 1, note, vel: Math.max(1, n.vel - 2), slide: true }))
  return out
}

// ── armonización ────────────────────────────────────────────────────────────
interface Window {
  at: number
  len: number
  mel: Note[]
}

/** tramos de medio compás (compases de 2 o 4 tiempos) o de compás (3, 5, 7) que cubren la selección */
function windowsOf(song: Song, sel: Note[]): Window[] {
  const spb = stepsPerBar(song)
  const unit = song.beatsPerBar % 2 === 0 ? spb / 2 : spb
  const from = Math.floor(Math.min(...sel.map((n) => n.step)) / unit) * unit
  const to = Math.ceil(Math.max(...sel.map((n) => n.step + n.len)) / unit) * unit
  const out: Window[] = []
  for (let at = from; at < to; at += unit) out.push({ at, len: unit, mel: sel.filter((n) => n.step < at + unit && n.step + n.len > at) })
  return out
}

/** pistas melódicas sin notas en el tramo, por orden de preferencia para hacer de voces */
function freeTracks(song: Song, patId: string, exclude: string, from: number, to: number, order: string[]): string[] {
  const p = getPattern(song, patId)
  if (!p) return []
  return order.filter((id) => {
    const t = song.tracks.find((x) => x.id === id)
    if (!t || isDrum(t) || id === exclude) return false
    return !(p.notes[id] ?? []).some((n) => n.step < to && n.step + n.len > from)
  })
}

const VOICE_ORDER = ['fm2', 'fm3', 'fm5', 'sq2', 'sq3', 'sq1', 'fm1', 'fm4']
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
const FUNCTION_BONUS = [0.6, 0.3, 0, 0.4, 0.5, 0.3, -0.4]

/** la disposición de las voces más cercana a la anterior, por debajo de `top` */
function voicing(pcs: number[], top: number, prev: number[] | null): number[] {
  const lo = top - 19
  const options = pcs.map((pc) => {
    const out: number[] = []
    for (let m = lo; m <= top; m++) if (mod12(m) === pc) out.push(m)
    return out
  })
  let best: number[] | null = null
  let bestCost = Infinity
  const pick = (i: number, acc: number[]): void => {
    if (i === options.length) {
      const v = [...acc].sort((a, b) => a - b)
      for (let k = 1; k < v.length; k++) if (v[k] === v[k - 1]) return
      const span = v[v.length - 1] - v[0]
      let cost = span > 14 ? (span - 14) * 2 : 0
      if (prev && prev.length === v.length) cost += v.reduce((a, x, k) => a + Math.abs(x - prev[k]), 0)
      else cost += Math.abs(v[v.length - 1] - top) * 0.5
      if (cost < bestCost) {
        bestCost = cost
        best = v
      }
      return
    }
    for (const m of options[i]) pick(i + 1, [...acc, m])
  }
  pick(0, [])
  return best ?? []
}

/** escribe voces sostenidas por tramos en varias pistas, ligando la misma nota en tramos seguidos */
function writeVoices(song: Song, patId: string, tracks: string[], columns: { at: number; len: number; notes: number[] }[], vel: number): void {
  const p = getPattern(song, patId)
  if (!p) return
  tracks.forEach((tr, i) => {
    const arr = (p.notes[tr] ??= [])
    let last: Note | null = null
    for (const c of columns) {
      const note = c.notes[i]
      if (note === undefined) {
        last = null
        continue
      }
      if (last && last.note === note && last.step + last.len === c.at) last.len += c.len
      else {
        last = { step: c.at, len: c.len, note, vel }
        arr.push(last)
      }
    }
    arr.sort(byStep)
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  Aplicar una figura
// ═════════════════════════════════════════════════════════════════════════════
export function applyFigure(song: Song, patId: string, trackId: string, selection: number[], id: FigureId): FigureResult {
  const p = getPattern(song, patId)
  const track = song.tracks.find((t) => t.id === trackId)
  const info = FIGURES.find((f) => f.id === id)
  if (!p || !track || !info) return { ok: false, message: 'No hay pista o patrón' }
  if (isDrum(track) && !info.drums) return { ok: false, message: `${info.name} es para pistas melódicas: elige una FM o un canal del PSG` }
  const arr = (p.notes[trackId] ??= [])
  arr.sort(byStep)
  const spb = stepsPerBar(song)
  const max = patternSteps(song, p)
  const pcs = scalePcs(song)
  const sel = selection.length ? selection.map((i) => arr[i]).filter((n): n is Note => !!n).sort(byStep) : []
  const targets = sel.length ? sel : arr.slice()
  if (!targets.length) return { ok: false, message: `La pista ${track.id.toUpperCase()} no tiene notas en este patrón` }
  const where = sel.length ? `${sel.length} notas seleccionadas` : 'la pista'

  switch (id) {
    case 'gradatio':
    case 'ostinato': {
      const m = motifOf(arr, sel, spb)
      if (!m) break
      const climb = id === 'gradatio'
      const reps = climb ? 3 : Math.floor((max - m.start - m.span) / m.span)
      if (reps < 1 || m.start + m.span >= max) return { ok: false, message: 'No queda sitio detrás del motivo en este patrón' }
      const end = Math.min(max, m.start + m.span * (reps + 1))
      clearRange(arr, m.start + m.span, end)
      let made = 0
      for (let k = 1; k <= reps && m.start + k * m.span < max; k++, made++) arr.push(...copyMotif(m, k * m.span, climb ? k : 0, pcs, max, climb ? k : 0, !isDrum(track)))
      arr.sort(byStep)
      return {
        ok: true,
        message: climb ? `GRADATIO: el motivo sube ${made} escalones, cada uno más fuerte` : `OSTINATO: el motivo se repite ${made} veces hasta el final del patrón`,
      }
    }
    case 'secuencia': {
      const m = motifOf(arr, sel, spb)
      if (!m) break
      if (m.start + m.span >= max) return { ok: false, message: 'No queda sitio detrás del motivo en este patrón' }
      const from = m.start
      const to = m.start + m.span
      const voices = song.tracks.filter((t) => !isDrum(t) && (p.notes[t.id] ?? []).some((n) => n.step >= from && n.step < to))
      const end = Math.min(max, m.start + m.span * 4)
      let made = 0
      for (const t of voices) {
        const a = (p.notes[t.id] ??= [])
        const vm: Motif = t.id === trackId ? m : { notes: a.filter((n) => n.step >= from && n.step < to), start: from, span: m.span }
        clearRange(a, to, end)
        for (let k = 1; k <= 3 && m.start + k * m.span < max; k++) {
          a.push(...copyMotif(vm, k * m.span, -k, pcs, max))
          if (t.id === trackId) made++
        }
        a.sort(byStep)
      }
      return { ok: true, message: `SECUENCIA: ${made} veces un grado más abajo, ${voices.length > 1 ? `con las ${voices.length} voces que suenan con el motivo` : 'la línea sola'}` }
    }
    case 'anafora': {
      const phrase = p.bars >= 4 ? 2 * spb : spb
      let head: Motif
      if (sel.length) head = motifOf(arr, sel, spb)!
      else {
        const first = Math.floor(arr[0].step / spb) * spb
        const notes = arr.filter((n) => n.step >= first && n.step < first + spb / 2)
        head = { notes: notes.length ? notes : [arr[0]], start: first, span: spb / 2 }
      }
      let made = 0
      for (let at = head.start + phrase; at < max; at += phrase) {
        clearRange(arr, at, Math.min(max, at + head.span))
        arr.push(...copyMotif(head, at - head.start, 0, pcs, max))
        made++
      }
      if (!made) return { ok: false, message: 'ANÁFORA necesita al menos dos frases en el patrón: alárgalo' }
      arr.sort(byStep)
      return { ok: true, message: `ANÁFORA: la cabeza vuelve al empezar ${made} frases de ${phrase / spb} compás${phrase > spb ? 'es' : ''}` }
    }
    case 'retardo': {
      const picks = sel.length ? topOfChords(sel) : arr.filter((n, i) => n.step % spb === 0 && n.len >= 2 && i > 0)
      let made = 0
      for (const n of picks) {
        if (n.len < 2) continue
        const up = stepDia(pcs, n.note, 1)
        const h = n.len >= 8 ? 4 : Math.max(1, Math.floor(n.len / 2))
        const prev = arr.find((q) => q !== n && q.step + q.len === n.step && q.note === up)
        if (prev) prev.len += h
        else arr.push({ step: n.step, len: h, note: up, vel: Math.min(15, n.vel + 1) })
        n.step += h
        n.len -= h
        n.vel = Math.max(1, n.vel - 2)
        n.slide = true
        made++
      }
      arr.sort(byStep)
      return made ? { ok: true, message: `RETARDO en ${made} notas: suena la de arriba y resuelve bajando` } : { ok: false, message: 'RETARDO necesita notas de dos pasos o más que empiecen compás (o selecciónalas)' }
    }
    case 'melisma': {
      const picks = targets.filter((n) => n.len >= (sel.length ? 4 : 6))
      if (!picks.length) return { ok: false, message: sel.length ? 'MELISMA necesita notas de cuatro pasos o más' : 'MELISMA: no hay notas de seis pasos o más (selecciona las que quieras adornar)' }
      for (const n of picks) {
        const next = arr.find((q) => q.step >= n.step + n.len)
        const run = melisma(n, next ? next.note : null, pcs)
        arr.splice(arr.indexOf(n), 1, ...run)
      }
      arr.sort(byStep)
      return { ok: true, message: `MELISMA en ${picks.length} notas largas` }
    }
    case 'mordente': {
      const set = new Set(sel.length ? sel : arr.filter((n) => n.len >= 4 && n.step % 4 === 0))
      const res = mordent(arr, (n) => set.has(n), pcs)
      const made = (res.length - arr.length) / 2
      if (!made) return { ok: false, message: sel.length ? 'MORDENTE necesita notas de tres pasos o más' : 'MORDENTE: no hay notas de un tiempo o más en tiempo (selecciona las que quieras adornar)' }
      arr.splice(0, arr.length, ...res.sort(byStep))
      return { ok: true, message: `MORDENTE en ${made} nota${made === 1 ? '' : 's'}` }
    }
    case 'unisono': {
      const from = Math.min(...targets.map((n) => n.step))
      const to = Math.max(...targets.map((n) => n.step + n.len))
      const order = track.kind === 'fm' ? ['sq1', 'sq2', 'sq3', 'fm4', 'fm2', 'fm3', 'fm5', 'fm1'] : ['fm4', 'fm2', 'fm3', 'fm5', 'fm1', 'sq1', 'sq2', 'sq3']
      let dest = freeTracks(song, patId, trackId, from, to, order)[0]
      if (!dest) {
        // ninguna libre: la que menos notas tenga en el tramo se sustituye
        const busy = order
          .filter((tid) => tid !== trackId && song.tracks.some((t) => t.id === tid && !isDrum(t)))
          .map((tid) => ({ tid, n: (p.notes[tid] ?? []).filter((q) => q.step < to && q.step + q.len > from).length }))
          .sort((a, b) => a.n - b.n)
        dest = busy[0]?.tid
        if (!dest) break
        clearRange((p.notes[dest] ??= []), from, to)
      }
      const d = (p.notes[dest] ??= [])
      for (const n of targets) d.push({ ...n, vel: Math.max(1, n.vel - 1) })
      d.sort(byStep)
      const dt = song.tracks.find((t) => t.id === dest)!
      return { ok: true, message: `UNÍSONO: ${targets.length} notas doblan en ${dt.id.toUpperCase()} ${dt.name}` }
    }
    case 'triada':
    case 'cuatriada':
    case 'cluster': {
      const wins = windowsOf(song, targets)
      const from = wins[0].at
      const to = wins[wins.length - 1].at + wins[wins.length - 1].len
      const want = id === 'triada' ? 3 : 4
      const tracks = freeTracks(song, patId, trackId, from, to, VOICE_ORDER).slice(0, want)
      if (!tracks.length) return { ok: false, message: 'No queda ninguna pista melódica libre en ese tramo para las voces' }
      const columns: { at: number; len: number; notes: number[] }[] = []
      const names: string[] = []
      let prevDeg = -1
      let prev: number[] | null = null
      let top = Math.min(...targets.map((n) => n.note)) - 2
      for (const w of wins) {
        if (w.mel.length) top = Math.min(...w.mel.map((n) => n.note)) - (id === 'cluster' ? 1 : 2)
        if (id === 'cluster') {
          const t0 = stepDia(pcs, top + 1, -1)
          const notes = [3, 2, 1, 0].map((k) => stepDia(pcs, t0, -k)).slice(4 - tracks.length)
          columns.push({ at: w.at, len: w.len, notes })
          continue
        }
        const deg = w.mel.length ? bestDegree(song, w, prevDeg, id === 'cuatriada') : Math.max(0, prevDeg)
        const c = diatonicChord(deg, song.key, song.scale, 48, id === 'cuatriada')
        let chordPcs = (CHORDS.find((x) => x.id === c.type)?.intervals ?? [0, 4, 7]).map((i) => mod12(c.root + i))
        // con menos pistas libres que notas: fuera la quinta y luego la fundamental
        if (chordPcs.length > tracks.length) chordPcs = chordPcs.filter((_, k) => k !== 2)
        if (chordPcs.length > tracks.length) chordPcs = chordPcs.filter((_, k) => k !== 0)
        const v = voicing(chordPcs.slice(0, tracks.length), top, prev)
        prev = v
        columns.push({ at: w.at, len: w.len, notes: v })
        if (deg !== prevDeg) names.push(ROMANS[deg] + (CHORDS.find((x) => x.id === c.type)?.label ?? ''))
        prevDeg = deg
      }
      writeVoices(song, patId, tracks, columns, id === 'cluster' ? 8 : 9)
      const where2 = tracks.map((t) => t.toUpperCase()).join(', ')
      if (id === 'cluster') return { ok: true, message: `CLUSTER de ${tracks.length} notas en ${wins.length} tramos · ${where2}` }
      const missing = tracks.length < want ? ` (solo ${tracks.length} pistas libres)` : ''
      return { ok: true, message: `${id === 'triada' ? 'TRÍADAS' : 'CUATRÍADAS'}: ${names.join(' · ')} en ${where2}${missing}` }
    }
    case 'legato': {
      let made = 0
      const line = targets.filter((n, i, a) => !a.some((q, k) => k !== i && q.step === n.step))
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]
        const b = line[i + 1]
        const gap = b.step - (a.step + a.len)
        if (gap < 0 || gap > 4) continue
        if (gap > 0) {
          a.len = b.step - a.step
          made++
        }
        if (a.note !== b.note && !b.slide) {
          b.slide = true
          made++
        }
      }
      return made ? { ok: true, message: `LEGATO en ${where}: sin huecos y ligado` } : { ok: false, message: 'Ya estaba todo ligado' }
    }
    case 'staccato': {
      let made = 0
      for (const n of targets) {
        if (n.slide) delete n.slide
        if (n.len >= 2) {
          n.len = Math.max(1, Math.floor(n.len / 2))
          made++
        }
      }
      return made ? { ok: true, message: `STACCATO: ${made} notas a la mitad` } : { ok: false, message: 'Todas las notas duran ya un paso: baja el GATE de la pista (INSTRUMENTO → ARTICULACIÓN)' }
    }
    case 'rubato': {
      let made = 0
      const line = targets.filter((n, i, a) => !a.some((q, k) => k !== i && q.step === n.step))
      const bars = new Map<number, Note[]>()
      for (const n of line) bars.set(Math.floor(n.step / spb), [...(bars.get(Math.floor(n.step / spb)) ?? []), n])
      for (const notes of bars.values()) {
        const cands = notes.filter((n, i) => {
          const next = notes[i + 1]
          return n.len >= 2 && next && next.step === n.step + n.len && next.len >= 2
        })
        if (!cands.length) continue
        const peak = cands.reduce((a, b) => (b.note > a.note ? b : a))
        const next = notes[notes.indexOf(peak) + 1]
        peak.len += 1
        peak.vel = Math.min(15, peak.vel + 1)
        next.step += 1
        next.len -= 1
        made++
      }
      arr.sort(byStep)
      return made ? { ok: true, message: `RUBATO en ${made} compases: la nota más alta se estira y la siguiente devuelve el tiempo` } : { ok: false, message: 'RUBATO necesita notas de dos pasos o más seguidas dentro del compás' }
    }
  }
  return { ok: false, message: 'Nada que hacer' }
}

/** de cada grupo de notas que empiezan a la vez, la más aguda */
function topOfChords(notes: Note[]): Note[] {
  const out = new Map<number, Note>()
  for (const n of notes) {
    const o = out.get(n.step)
    if (!o || n.note > o.note) out.set(n.step, n)
  }
  return [...out.values()]
}

/** el grado cuyo acorde mejor recoge las notas del tramo (la de la parte fuerte cuenta doble) */
function bestDegree(song: Song, w: Window, prevDeg: number, seventh: boolean): number {
  let best = 0
  let bestScore = -Infinity
  for (let deg = 0; deg < 7; deg++) {
    const c = diatonicChord(deg, song.key, song.scale, 48, seventh)
    const type: ChordType = c.type
    const pcs = (CHORDS.find((x) => x.id === type)?.intervals ?? [0, 4, 7]).map((i) => mod12(c.root + i))
    let score = FUNCTION_BONUS[deg]
    for (const n of w.mel) {
      const over = Math.min(n.step + n.len, w.at + w.len) - Math.max(n.step, w.at)
      const weight = (over / w.len) * (n.step === w.at ? 2 : 1)
      score += pcs.includes(mod12(n.note)) ? weight : -0.6 * weight
    }
    if (prevDeg === 4 && deg === 0) score += 0.4
    if (prevDeg === 1 && deg === 4) score += 0.3
    if (prevDeg === 3 && (deg === 4 || deg === 0)) score += 0.2
    if (deg === prevDeg) score -= 0.3
    if (score > bestScore) {
      bestScore = score
      best = deg
    }
  }
  return best
}
