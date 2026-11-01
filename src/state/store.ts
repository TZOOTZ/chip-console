// ── Estado global de la app (zustand + immer) ───────────────────────────────
import { produce } from 'immer'
import type { ShownReport } from './importer'
import { create } from 'zustand'
import type { SoundModel } from '../core/mixer'
import { createEmptySong } from '../music/presets'
import { getPattern, type Note, type Song } from '../music/song'

export type PanelId = 'inst' | 'compose' | 'song'
/** dónde se acopla el inspector: automático según la pantalla, a la derecha o abajo */
export type DockMode = 'auto' | 'right' | 'bottom'

const HISTORY_LIMIT = 120
const PREFS_KEY = 'tz-megadrive:prefs'

/** preferencias de interfaz que se recuerdan entre sesiones */
export interface Prefs {
  /** escala de la interfaz: 'auto' la calcula según la resolución */
  uiScale: number | 'auto'
  dock: DockMode
  crt: boolean
  showKeyboard: boolean
  /** altura del inspector cuando está abajo (px de diseño, a escala 100 %) */
  panelH: number
  inspectorOpen: boolean
  /** carácter de sonido de la consola: Model 1 (DAC discreto + paso-bajo) o limpio */
  sound: SoundModel
}

const DEFAULT_PREFS: Prefs = { uiScale: 'auto', dock: 'auto', crt: true, showKeyboard: true, panelH: 230, inspectorOpen: true, sound: 'md1' }

function loadPrefs(): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    if (raw.uiScale === 'auto' || (typeof raw.uiScale === 'number' && raw.uiScale >= 0.75 && raw.uiScale <= 2.5)) p.uiScale = raw.uiScale
    if (raw.dock === 'auto' || raw.dock === 'right' || raw.dock === 'bottom') p.dock = raw.dock
    if (typeof raw.crt === 'boolean') p.crt = raw.crt
    if (typeof raw.showKeyboard === 'boolean') p.showKeyboard = raw.showKeyboard
    if (typeof raw.panelH === 'number' && raw.panelH >= 40 && raw.panelH <= 900) p.panelH = raw.panelH
    if (typeof raw.inspectorOpen === 'boolean') p.inspectorOpen = raw.inspectorOpen
    if (raw.sound === 'md1' || raw.sound === 'clean') p.sound = raw.sound
  } catch {
    /* sin almacenamiento o JSON inválido: valores por defecto */
  }
  return p
}

export function savePrefs(s: Prefs): void {
  try {
    const p: Prefs = { uiScale: s.uiScale, dock: s.dock, crt: s.crt, showKeyboard: s.showKeyboard, panelH: s.panelH, inspectorOpen: s.inspectorOpen, sound: s.sound }
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* sin almacenamiento */
  }
}

export const PREF_KEYS: (keyof Prefs)[] = ['uiScale', 'dock', 'crt', 'showKeyboard', 'panelH', 'inspectorOpen', 'sound']

export interface ClipboardNotes {
  trackKind: string
  notes: Note[]
}

export interface AppState extends Prefs {
  song: Song
  // selección
  selTrack: number
  selPattern: string
  selNotes: number[]
  // vista del piano roll (px de diseño a escala 100 %)
  zoom: number
  rowH: number
  noteLen: number
  noteVel: number
  grid: number
  scaleLock: boolean
  panel: PanelId
  /** escala efectiva de la interfaz (resuelta: nunca 'auto') */
  scale: number
  // transporte
  playing: boolean
  followPlay: boolean
  loopPattern: boolean
  recording: boolean
  metronome: boolean
  /** octava base del teclado virtual */
  octave: number
  /** notas (o pads) que suenan ahora mismo en directo */
  heldNotes: number[]
  midiDevices: string[]
  // historial
  past: Song[]
  future: Song[]
  coalesceKey: string | null
  coalesceAt: number
  // misc
  clipboard: ClipboardNotes | null
  toast: { text: string; at: number } | null
  dirty: boolean
  /** diálogo "tema nuevo" abierto (lo abren la cabecera, el panel CANCIÓN y la pantalla de arranque) */
  newSongOpen: boolean
  /** informe de la última importación de MIDI o VGM (el diálogo se abre mientras haya uno) */
  importReport: ShownReport | null

  // acciones
  edit: (fn: (draft: Song) => void, coalesce?: string) => void
  replaceSong: (song: Song, opts?: { keepHistory?: boolean }) => void
  undo: () => void
  redo: () => void
  set: (patch: Partial<AppState>) => void
  selectTrack: (i: number) => void
  selectPattern: (id: string) => void
  setSelNotes: (idx: number[]) => void
  notify: (text: string) => void
}

export const useApp = create<AppState>((set, get) => {
  const song = createEmptySong()
  return {
    ...loadPrefs(),
    song,
    selTrack: 0,
    selPattern: song.patterns[0].id,
    selNotes: [],
    zoom: 22,
    rowH: 15,
    noteLen: 2,
    noteVel: 12,
    grid: 1,
    scaleLock: false,
    panel: 'compose',
    scale: 1,
    playing: false,
    followPlay: true,
    loopPattern: false,
    recording: false,
    metronome: false,
    octave: 4,
    heldNotes: [],
    midiDevices: [],
    past: [],
    future: [],
    coalesceKey: null,
    coalesceAt: 0,
    clipboard: null,
    toast: null,
    dirty: false,
    newSongOpen: false,
    importReport: null,

    edit: (fn, coalesce) => {
      const s = get()
      // el valor de retorno de la receta se ignora: Immer lanza el error 4 si una receta muta el
      // borrador y además devuelve algo (p. ej. `(d) => (d.bpm = v)`)
      const next = produce(s.song, (d) => {
        fn(d)
      })
      if (next === s.song) return
      const now = performance.now()
      const merge = coalesce !== undefined && coalesce === s.coalesceKey && now - s.coalesceAt < 1200
      set({
        song: next,
        past: merge ? s.past : [...s.past, s.song].slice(-HISTORY_LIMIT),
        future: [],
        coalesceKey: coalesce ?? null,
        coalesceAt: now,
        dirty: true,
      })
    },

    replaceSong: (song, opts) => {
      const s = get()
      const selPattern = getPattern(song, s.selPattern) ? s.selPattern : song.patterns[0].id
      set({
        song,
        selPattern,
        selTrack: Math.min(s.selTrack, song.tracks.length - 1),
        selNotes: [],
        past: opts?.keepHistory ? [...s.past, s.song].slice(-HISTORY_LIMIT) : [],
        future: [],
        coalesceKey: null,
        dirty: false,
      })
    },

    undo: () => {
      const s = get()
      if (s.past.length === 0) return
      const prev = s.past[s.past.length - 1]
      const selPattern = getPattern(prev, s.selPattern) ? s.selPattern : prev.patterns[0].id
      set({
        song: prev,
        past: s.past.slice(0, -1),
        future: [s.song, ...s.future].slice(0, HISTORY_LIMIT),
        selPattern,
        selNotes: [],
        coalesceKey: null,
        dirty: true,
      })
    },

    redo: () => {
      const s = get()
      if (s.future.length === 0) return
      const next = s.future[0]
      const selPattern = getPattern(next, s.selPattern) ? s.selPattern : next.patterns[0].id
      set({
        song: next,
        past: [...s.past, s.song].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        selPattern,
        selNotes: [],
        coalesceKey: null,
        dirty: true,
      })
    },

    set: (patch) => set(patch),
    selectTrack: (i) => set({ selTrack: i, selNotes: [] }),
    selectPattern: (id) => set({ selPattern: id, selNotes: [] }),
    setSelNotes: (idx) => set({ selNotes: idx }),
    notify: (text) => set({ toast: { text, at: Date.now() } }),
  }
})

/** selectores derivados */
export const selectPatternObj = (s: AppState) => getPattern(s.song, s.selPattern) ?? s.song.patterns[0]
export const selectTrackObj = (s: AppState) => s.song.tracks[s.selTrack]
