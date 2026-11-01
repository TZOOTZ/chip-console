// ── Controlador: puente entre el store, el motor de audio y la entrada en vivo ─
import { engine } from '../engine/client'
import { addNote } from '../music/edit'
import { getPattern, patternSteps, type Song } from '../music/song'
import { loadAutosave, saveAutosave } from './persist'
import { PREF_KEYS, savePrefs, useApp } from './store'

/** canción que realmente se envía al motor (patrón en bucle = orden de 1 elemento) */
export function effectiveSong(song: Song, loopPattern: boolean, selPattern: string): Song {
  if (!loopPattern) return song
  return { ...song, order: [selPattern], loopStart: 0 }
}

/** id del patrón que está sonando según la posición del motor */
export function playingPatternId(song: Song, order: number, loopPattern: boolean, selPattern: string): string | undefined {
  return loopPattern ? selPattern : song.order[order]
}

// ── transporte ──────────────────────────────────────────────────────────────
let lastPlayReq = 0
let lastStopReq = 0

/** Reproduce desde un punto concreto del orden/paso (único camino de reproducción). */
export async function playFrom(order: number, step = 0): Promise<void> {
  const s = useApp.getState()
  engine.setSong(effectiveSong(s.song, s.loopPattern, s.selPattern))
  const preroll = s.recording && step === 0 ? s.song.beatsPerBar * 4 : 0
  lastPlayReq = performance.now()
  const ok = await engine.play(s.loopPattern ? 0 : order, step, preroll)
  if (ok) useApp.getState().set({ playing: true })
}

export async function play(fromStart = false): Promise<void> {
  const s = useApp.getState()
  let order = 0
  if (!fromStart && !s.loopPattern) {
    const i = s.song.order.indexOf(s.selPattern)
    if (i >= 0) order = i
  }
  await playFrom(order, 0)
}

export function stop(): void {
  lastStopReq = performance.now()
  engine.stop()
  engine.panic()
  useApp.getState().set({ playing: false })
}

export function togglePlay(): void {
  const s = useApp.getState()
  if (s.playing) stop()
  else void play()
}

export function toggleRecord(): void {
  const s = useApp.getState()
  s.set({ recording: !s.recording })
  if (!s.recording) s.notify('REC armado: toca notas con el teclado/MIDI mientras suena')
}

export function toggleLoopPattern(): void {
  const s = useApp.getState()
  const next = !s.loopPattern
  s.set({ loopPattern: next })
  const name = getPattern(s.song, s.selPattern)?.name ?? s.selPattern
  s.notify(next ? `Repitiendo solo el patrón ${name} · C para volver al orden` : 'Bucle de patrón desactivado: suena todo el orden')
  engine.setSong(effectiveSong(s.song, next, s.selPattern))
  if (s.playing) void play()
}

/** silencia / activa o solea una pista (atajos Shift + número y Alt + número) */
export function toggleTrackFlag(index: number, flag: 'mute' | 'solo'): void {
  const s = useApp.getState()
  const t = s.song.tracks[index]
  if (!t) return
  const on = !t[flag]
  s.edit((d) => {
    d.tracks[index][flag] = on
  })
  s.notify(`${t.name}: ${flag === 'mute' ? (on ? 'silenciada' : 'suena') : on ? 'solo' : 'sin solo'}`)
}

/** todas las pistas suenan: fuera todos los mute y solo */
export function clearMuteSolo(): void {
  const s = useApp.getState()
  if (!s.song.tracks.some((t) => t.mute || t.solo)) return
  s.edit((d) => {
    for (const t of d.tracks) {
      t.mute = false
      t.solo = false
    }
  })
  s.notify('Todas las pistas suenan')
}

export function toggleMetronome(): void {
  const s = useApp.getState()
  s.set({ metronome: !s.metronome })
  engine.setMetronome(!s.metronome)
}

// ── entrada en vivo (teclado de ordenador, teclado en pantalla, MIDI) ────────
const held = new Map<string, number>() // "pista:nota" → track index (para soltar bien)

export function liveOn(note: number, vel = 12): void {
  const s = useApp.getState()
  const ti = s.selTrack
  const tr = s.song.tracks[ti]
  if (!tr) return
  held.set(`${ti}:${note}`, ti)
  const cur = useApp.getState().heldNotes
  if (!cur.includes(note)) s.set({ heldNotes: [...cur, note] })
  void engine.liveOn(ti, note, vel)
}

export function liveOff(note: number): void {
  const s = useApp.getState()
  s.set({ heldNotes: s.heldNotes.filter((n) => n !== note) })
  const ti = s.selTrack
  const key = `${ti}:${note}`
  const t = held.get(key)
  if (t === undefined) {
    // la pista cambió mientras sonaba: suelta en todas las que la tengan
    for (const [k, v] of held) {
      if (!k.endsWith(`:${note}`)) continue
      engine.liveOff(v, note)
      held.delete(k)
    }
    return
  }
  held.delete(key)
  engine.liveOff(t, note)
}

export function releaseAllLive(): void {
  useApp.getState().set({ heldNotes: [] })
  for (const [k, ti] of held) {
    const note = Number(k.split(':')[1])
    engine.liveOff(ti, note)
  }
  held.clear()
}

// ── grabación ───────────────────────────────────────────────────────────────
interface Pending {
  pid: string
  step: number
  vel: number
  order: number
  track: number
}
const pending = new Map<string, Pending>()

function commitRecorded(p: Pending, endStep: number | null, note: number): void {
  const s = useApp.getState()
  const tr = s.song.tracks[p.track]
  const pat = getPattern(s.song, p.pid)
  if (!tr || !pat) return
  const max = patternSteps(s.song, pat)
  const grid = Math.max(1, s.grid)
  let start = Math.round(p.step / grid) * grid
  if (start >= max) start = 0
  let len = 1
  if (endStep !== null && tr.kind !== 'dac' && tr.kind !== 'noise') {
    let span = endStep - p.step
    if (span < 0) span += max // la nota cruzó el final del patrón
    len = Math.max(grid, Math.round(span / grid) * grid)
  }
  len = Math.max(1, Math.min(len, max - start))
  s.edit((d) => addNote(d, p.pid, tr.id, { step: start, len, note, vel: p.vel }))
}

function onLive(m: { on: boolean; track: number; note: number; vel: number; playing: boolean; pos: { order: number; step: number; frac: number } }): void {
  const s = useApp.getState()
  if (!s.recording || !m.playing) return
  const key = `${m.track}:${m.note}`
  const pid = playingPatternId(s.song, m.pos.order, s.loopPattern, s.selPattern)
  if (!pid) return
  const pos = m.pos.step + m.pos.frac
  const tr = s.song.tracks[m.track]
  if (!tr) return
  if (m.on) {
    const p: Pending = { pid, step: pos, vel: m.vel, order: m.pos.order, track: m.track }
    if (tr.kind === 'dac' || tr.kind === 'noise') commitRecorded(p, null, m.note)
    else pending.set(key, p)
  } else {
    const p = pending.get(key)
    if (!p) return
    pending.delete(key)
    commitRecorded(p, pos, m.note)
  }
}

// ── arranque: sincroniza store ⇄ motor ⇄ almacenamiento ─────────────────────
let booted = false
export function bootController(): () => void {
  if (booted) return () => {}
  booted = true
  let saveTimer = 0

  const unsubStore = useApp.subscribe((s, prev) => {
    if (s.song !== prev.song || s.loopPattern !== prev.loopPattern || s.selPattern !== prev.selPattern) {
      engine.setSong(effectiveSong(s.song, s.loopPattern, s.selPattern))
    }
    if (s.song !== prev.song) {
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => saveAutosave(useApp.getState().song), 700)
    }
    if (s.sound !== prev.sound) engine.setModel(s.sound)
    // las preferencias de interfaz se recuerdan entre sesiones
    if (PREF_KEYS.some((k) => s[k] !== prev[k])) savePrefs(s)
  })
  const offStop = engine.onStop(() => {
    useApp.getState().set({ playing: false })
    pending.clear()
  })
  // el motor manda: si el estado real discrepa de la UI (pasado un margen), la UI se corrige
  const offStatus = engine.onStatus((s) => {
    const cur = useApp.getState().playing
    if (s.playing === cur) return
    const now = performance.now()
    if (s.playing && now - lastStopReq > 500) useApp.getState().set({ playing: true })
    else if (!s.playing && now - lastPlayReq > 500) useApp.getState().set({ playing: false })
  })
  const offLive = engine.onLive(onLive)
  engine.setModel(useApp.getState().sound)
  engine.setSong(effectiveSong(useApp.getState().song, false, useApp.getState().selPattern))
  return () => {
    unsubStore()
    offStop()
    offStatus()
    offLive()
    booted = false
  }
}

/** carga la canción inicial: enlace compartido > autoguardado > null */
export function initialSong(songFromHash: (h: string) => Song | null): { song: Song | null; from: 'hash' | 'autosave' | 'none' } {
  const fromHash = songFromHash(location.hash)
  if (fromHash) return { song: fromHash, from: 'hash' }
  const auto = loadAutosave()
  if (auto) return { song: auto, from: 'autosave' }
  return { song: null, from: 'none' }
}
