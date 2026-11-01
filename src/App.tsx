// ── TZOOTZ · Chip Console — estudio de chiptune YM2612 + SN76489 ─────────────
import { useEffect, useLayoutEffect, useState } from 'react'
import { engine } from './engine/client'
import { songFromLocationHash } from './export/share'
import { generateSong } from './music/generator'
import { liveOff, liveOn, bootController, initialSong, play, releaseAllLive, stop, clearMuteSolo, toggleLoopPattern, toggleRecord, toggleTrackFlag } from './state/controller'
import { saveToLibrary } from './state/persist'
import { useApp } from './state/store'
import { Arrangement } from './ui/Arrangement'
import { Header } from './ui/Header'
import { Icon } from './ui/icons'
import { autoScale, useMediaQuery, useViewport } from './ui/hooks'
import { Inspector } from './ui/Inspector'
import { Keyboard } from './ui/Keyboard'
import { importFileToApp } from './state/importer'
import { KEYMAP, PAD_KEYS } from './ui/keymap'
import { Logo } from './ui/Logo'
import { ImportReportDialog } from './ui/ImportReportDialog'
import { NewSongDialog } from './ui/NewSongDialog'
import { PianoRoll } from './ui/PianoRoll'
import { Scope } from './ui/Scope'
import { TrackList, TrackStrip } from './ui/TrackList'

function Boot({ onStart, onNew, from }: { onStart: () => void; onNew: () => void; from: string }) {
  // Enter o Espacio encienden también cuando el foco no está en ningún botón
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) onStart()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onStart])

  return (
    // un clic en cualquier parte enciende; los botones son el camino con teclado
    <div className="boot" onClick={onStart}>
      <Logo className="boot-logo" title="TZOOTZ" />
      <div className="boot-1 glow">
        TZOOTZ<i>▸</i>RESEARCH
      </div>
      <div className="boot-2">MEGA DRIVE STUDIO</div>
      <div className="boot-3">YM2612 FM · SN76489 PSG · DAC PCM</div>
      <button className="boot-go glow" autoFocus>
        <span className="blink">&gt; PULSA PARA ENCENDER_</span>
      </button>
      <div className="boot-3 boot-from">{from === 'hash' ? 'Tema compartido cargado' : from === 'autosave' ? 'Tu último proyecto está listo' : 'Se generará un tema de arranque'}</div>
      <button
        className="btn lg boot-new"
        onClick={(e) => {
          e.stopPropagation()
          onNew()
        }}
      >
        {Icon.newFile} O EMPIEZA UN TEMA DE CERO
      </button>
    </div>
  )
}

function Toast() {
  const toast = useApp((s) => s.toast)
  if (!toast) return null
  // la animación CSS lo muestra y lo desvanece sola; la key reinicia cada aviso
  return (
    <div key={toast.at} className="toast-life" role="status">
      {toast.text}
    </div>
  )
}

function useHotkeys(started: boolean) {
  useEffect(() => {
    if (!started) return
    const held = new Set<string>()
    // campos donde escribir de verdad (los <select> NO: su "type-ahead" cambiaría instrumentos al tocar)
    const typing = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null
      if (!t) return false
      if (t instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button', 'file'].includes(t.type)
      return t instanceof HTMLTextAreaElement || t.isContentEditable
    }

    // al elegir una opción, el desplegable suelta el foco para que las teclas vuelvan a ser notas
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLSelectElement) e.target.blur()
    }

    // con un diálogo abierto mandan sus controles: ni notas ni atajos por debajo
    const modal = (): boolean => document.querySelector('dialog[open]') !== null

    const down = (e: KeyboardEvent) => {
      if (modal()) return
      if (typing(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (e.target instanceof HTMLSelectElement && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // evita el type-ahead del desplegable: la tecla es una nota/atajo de la app
        e.preventDefault()
        e.target.blur()
      }
      const st = useApp.getState()
      const k = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey

      // Shift + número silencia la pista, Alt + número la solea y Alt + M deja sonar todo
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)
      if (digit && !mod && (e.shiftKey || e.altKey)) {
        e.preventDefault()
        const idx = digit[1] === '0' ? 9 : Number(digit[1]) - 1
        if (idx < st.song.tracks.length) toggleTrackFlag(idx, e.altKey ? 'solo' : 'mute')
        return
      }
      if (e.altKey && !mod && e.code === 'KeyM') {
        e.preventDefault()
        clearMuteSolo()
        return
      }

      if (mod) {
        if (k === 'z') {
          e.preventDefault()
          if (e.shiftKey) st.redo()
          else st.undo()
        } else if (k === 'y') {
          e.preventDefault()
          st.redo()
        } else if (k === 's') {
          e.preventDefault()
          saveToLibrary(useApp.getState().song)
          useApp.getState().notify('Guardado en la biblioteca local')
        }
        return
      }
      if (e.altKey) return

      if (k === ' ') {
        e.preventDefault()
        if (st.playing) stop()
        else void play()
        return
      }
      if (k === 'enter') {
        e.preventDefault()
        void play(true)
        return
      }
      if (k === 'escape') {
        stop()
        releaseAllLive()
        return
      }
      if (k === 'r' && !e.repeat) {
        toggleRecord()
        return
      }
      if (k === 'c' && !e.repeat) {
        toggleLoopPattern()
        return
      }
      if (/^[0-9]$/.test(k)) {
        const idx = k === '0' ? 9 : Number(k) - 1
        if (idx < st.song.tracks.length) st.selectTrack(idx)
        return
      }
      if (k === '[' || k === ']') {
        const ids = st.song.patterns.map((p) => p.id)
        const i = ids.indexOf(st.selPattern)
        const ni = Math.max(0, Math.min(ids.length - 1, i + (k === ']' ? 1 : -1)))
        st.selectPattern(ids[ni])
        return
      }
      if (k === 'z') {
        st.set({ octave: Math.max(1, st.octave - 1) })
        return
      }
      if (k === 'x') {
        st.set({ octave: Math.min(7, st.octave + 1) })
        return
      }
      if (e.repeat || held.has(k)) return

      const tr = st.song.tracks[st.selTrack]
      const drumTrack = tr.kind === 'dac' || tr.kind === 'noise'
      if (drumTrack) {
        const pad = PAD_KEYS.indexOf(k)
        if (pad >= 0) {
          held.add(k)
          liveOn(pad, st.noteVel)
          return
        }
      } else if (k in KEYMAP) {
        held.add(k)
        liveOn(12 * (st.octave + 1) + KEYMAP[k], st.noteVel)
        return
      }
      // N M , . → batería directa en cualquier pista
      const drumMap: Record<string, number> = { n: 0, m: 1, ',': 2, '.': 4 }
      if (k in drumMap) {
        const di = st.song.tracks.findIndex((t) => t.kind === 'dac')
        if (di >= 0) {
          held.add(k)
          void engine.preview(di, drumMap[k], st.noteVel)
        }
      }
    }

    const up = (e: KeyboardEvent) => {
      if (modal()) return
      const k = e.key.toLowerCase()
      // Espacio sobre un botón enfocado dispararía un click al soltar la tecla
      if (k === ' ' && !typing(e.target)) e.preventDefault()
      if (!held.has(k)) return
      held.delete(k)
      const st = useApp.getState()
      const tr = st.song.tracks[st.selTrack]
      if (tr.kind === 'dac' || tr.kind === 'noise') {
        const pad = PAD_KEYS.indexOf(k)
        if (pad >= 0) liveOff(pad)
      } else if (k in KEYMAP) {
        liveOff(12 * (st.octave + 1) + KEYMAP[k])
      }
    }

    const blur = () => {
      held.clear()
      releaseAllLive()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('change', onChange, true)
    // al cambiar de pista soltamos las notas para no dejarlas colgadas
    const unsub = useApp.subscribe((s, p) => {
      if (s.selTrack !== p.selTrack) {
        held.clear()
        releaseAllLive()
      }
    })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('change', onChange, true)
      unsub()
    }
  }, [started])
}

/** resuelve la escala de la interfaz (auto según la resolución) y la aplica al rem raíz */
function useUiScale(): { scale: number; w: number; h: number } {
  const vp = useViewport()
  const uiScale = useApp((s) => s.uiScale)
  const scale = uiScale === 'auto' ? autoScale(vp.w, vp.h) : uiScale
  useLayoutEffect(() => {
    document.documentElement.style.fontSize = `${16 * scale}px`
    if (useApp.getState().scale !== scale) useApp.getState().set({ scale })
  }, [scale])
  return { scale, w: vp.w, h: vp.h }
}

export default function App() {
  const [started, setStarted] = useState(false)
  // se lee una sola vez: enlace compartido > autoguardado > nada
  const [init] = useState(() => initialSong(songFromLocationHash))
  const from = init.from
  const compact = useMediaQuery('(max-width: 760px)')
  const { scale, w, h } = useUiScale()
  const crt = useApp((s) => s.crt)
  const showKeyboard = useApp((s) => s.showKeyboard)
  const dockPref = useApp((s) => s.dock)
  const inspectorOpen = useApp((s) => s.inspectorOpen)
  const replaceSong = useApp((s) => s.replaceSong)
  const selectPattern = useApp((s) => s.selectPattern)

  // en pantallas panorámicas el inspector va a la derecha y el piano roll se queda con toda la altura
  const wide = w / scale >= 1180 && w / h >= 1.45
  const dock: 'right' | 'bottom' = compact ? 'bottom' : dockPref === 'auto' ? (wide ? 'right' : 'bottom') : dockPref

  // carga inicial: enlace compartido > autoguardado > tema de arranque
  useEffect(() => {
    const s = init.song ?? generateSong({ style: 'cosmic', seed: 21, key: 9 })
    replaceSong(s)
    selectPattern(s.patterns[0].id)
    // arranca con una pista que tenga música para que el piano roll no se vea vacío
    const firstWithNotes = s.tracks.findIndex((t) => (s.patterns[0].notes[t.id]?.length ?? 0) > 0 && t.kind !== 'dac' && t.kind !== 'noise')
    if (firstWithNotes > 0) useApp.getState().selectTrack(firstWithNotes)
    if (init.from === 'hash') history.replaceState(null, '', location.pathname + location.search)
    return bootController()
  }, [init, replaceSong, selectPattern])

  useHotkeys(started)

  // soltar un .mid, .vgm, .vgz o un proyecto sobre la ventana lo abre
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      e.preventDefault()
      void importFileToApp(file)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const start = async (fromScratch = false) => {
    setStarted(true)
    if (fromScratch) useApp.getState().set({ newSongOpen: true })
    try {
      await engine.start()
      await engine.resume()
    } catch (e) {
      useApp.getState().notify(`Audio no disponible: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!started) {
    return (
      <>
        <Boot onStart={() => void start()} onNew={() => void start(true)} from={from} />
        {crt && <div className="crt-scan" />}
      </>
    )
  }

  return (
    <div className="app">
      <Header />
      <div className={compact ? 'app-body col' : 'app-body'}>
        {compact ? <TrackStrip /> : <TrackList />}
        <main className="app-main">
          <Arrangement />
          <PianoRoll />
          {dock === 'bottom' && <Inspector dock="bottom" />}
        </main>
        {dock === 'right' && <Inspector dock="right" />}
      </div>
      {showKeyboard && (
        <footer className="foot">
          <Keyboard octaves={compact ? 2 : 3} />
          {!compact && (
            <div className={dock === 'right' && inspectorOpen ? 'scope-box wide' : 'scope-box'}>
              <span>SCOPE</span>
              <Logo className="foot-logo" />
              <Scope />
            </div>
          )}
        </footer>
      )}
      <NewSongDialog />
      <ImportReportDialog />
      <Toast />
      {crt && (
        <>
          <div className="crt-scan" />
          <div className="crt-vig" />
        </>
      )}
    </div>
  )
}
