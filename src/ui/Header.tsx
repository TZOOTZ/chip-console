// ── Cabecera: marca, transporte, LCD (posición · tempo · compás · tono · título) y acciones ─
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { engine } from '../engine/client'
import { shareUrl } from '../export/share'
import { getPattern, stepsPerBar } from '../music/song'
import { NOTE_NAMES, type ScaleId } from '../music/theory'
import { play, stop, toggleLoopPattern, toggleMetronome, toggleRecord } from '../state/controller'
import type { SoundModel } from '../core/mixer'
import { useApp, type DockMode } from '../state/store'
import { NumField, Popover, Segmented, TextField } from './controls'
import { ExportDialog } from './ExportDialog'
import { HelpDialog } from './Help'
import { autoScale, useViewport } from './hooks'
import { Icon } from './icons'
import { Logo } from './Logo'
import { cx } from './util'

const SCALE_SHORT: Record<ScaleId, string> = {
  minor: 'menor',
  major: 'mayor',
  dorian: 'dórico',
  phrygian: 'frigio',
  lydian: 'lidio',
  mixolydian: 'mixolidio',
  locrian: 'locrio',
  harmonicMinor: 'm. arm.',
  melodicMinor: 'm. mel.',
  phrygianDominant: 'frig. dom.',
  pentMinor: 'penta m',
  pentMajor: 'penta M',
  blues: 'blues',
  chromatic: 'crom.',
}

function Position() {
  const song = useApp((s) => s.song)
  const loopPattern = useApp((s) => s.loopPattern)
  const playing = useApp((s) => s.playing)
  const [live, setTxt] = useState('001.1.1')
  const last = useRef('')
  const txt = playing ? live : '001.1.1'

  useEffect(() => {
    if (!playing) return
    return engine.onStatus((s) => {
      const spb = stepsPerBar(song)
      let bars = 0
      if (!loopPattern) {
        for (let i = 0; i < s.pos.order; i++) bars += getPattern(song, song.order[i])?.bars ?? 0
      }
      const bar = bars + Math.floor(s.pos.step / spb) + 1
      const beat = Math.floor((s.pos.step % spb) / 4) + 1
      const six = (s.pos.step % 4) + 1
      const t = `${String(bar).padStart(3, '0')}.${beat}.${six}`
      if (t !== last.current) {
        last.current = t
        setTxt(t)
      }
    })
  }, [playing, song, loopPattern])

  return (
    <div className="lcd-pos" title="Compás . pulso . semicorchea">
      {txt}
    </div>
  )
}

const UI_SCALES: { value: number | 'auto'; label: string }[] = [
  { value: 'auto', label: 'AUTO' },
  { value: 0.9, label: '90' },
  { value: 1, label: '100' },
  { value: 1.1, label: '110' },
  { value: 1.25, label: '125' },
  { value: 1.5, label: '150' },
  { value: 1.75, label: '175' },
  { value: 2, label: '200' },
]

const DOCKS: { value: DockMode; label: string; title: string }[] = [
  { value: 'auto', label: 'AUTO', title: 'A la derecha en pantallas panorámicas; abajo en el resto' },
  { value: 'right', label: 'DERECHA', title: 'Columna a la derecha: deja toda la altura al piano roll' },
  { value: 'bottom', label: 'ABAJO', title: 'Franja inferior a todo lo ancho' },
]

const SOUNDS: { value: SoundModel; label: string; title: string }[] = [
  { value: 'md1', label: 'MODEL 1', title: 'Como la consola: DAC de 9 bits del YM2612 (grano en colas y notas suaves) y el paso-bajo de la placa' },
  { value: 'clean', label: 'LIMPIO', title: 'Suma ideal de los chips, sin grano ni filtro' },
]

function Settings() {
  const sound = useApp((s) => s.sound)
  const uiScale = useApp((s) => s.uiScale)
  const scale = useApp((s) => s.scale)
  const dock = useApp((s) => s.dock)
  const crt = useApp((s) => s.crt)
  const showKeyboard = useApp((s) => s.showKeyboard)
  const set = useApp((s) => s.set)
  const vp = useViewport()
  return (
    <Popover
      button={(open, toggle) => (
        <button className={cx('btn icon', open && 'on')} onClick={toggle} title="Ajustes: sonido de la consola, tamaño, panel, teclado, CRT" aria-label="Ajustes" aria-expanded={open}>
          {Icon.gear}
        </button>
      )}
    >
      <div className="title-px">SONIDO</div>
      <div className="flex flex-col gap-1">
        <Segmented value={sound} options={SOUNDS} onChange={(v) => set({ sound: v })} fill label="Carácter de sonido" />
        <p className="hint">{sound === 'md1' ? 'Suena como la consola: grano del DAC y agudos suavizados. También se exporta así el WAV.' : 'Sin el grano ni el filtro de la consola. El balance entre FM y PSG es el mismo.'}</p>
      </div>
      <div className="title-px">INTERFAZ</div>
      <div className="flex flex-col gap-1">
        <span className="label">
          TAMAÑO · <b style={{ color: 'var(--accent-hi)' }}>{Math.round(scale * 100)} %</b>
        </span>
        <Segmented value={uiScale} options={UI_SCALES} onChange={(v) => set({ uiScale: v })} fill label="Tamaño de la interfaz" />
        <p className="hint">
          AUTO lo ajusta a tu pantalla: {vp.w}×{vp.h} → <b>{Math.round(autoScale(vp.w, vp.h) * 100)} %</b>
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">PANEL DE HERRAMIENTAS</span>
        <Segmented value={dock} options={DOCKS} onChange={(v) => set({ dock: v, inspectorOpen: true })} fill label="Posición del panel" />
      </div>
      <div className="row">
        <button className={cx('btn', showKeyboard && 'on')} onClick={() => set({ showKeyboard: !showKeyboard })} title="Muestra u oculta el teclado y el osciloscopio">
          {Icon.keys} TECLADO
        </button>
        <button className={cx('btn', crt && 'on')} onClick={() => set({ crt: !crt })} title="Líneas de barrido y viñeta de monitor de tubo">
          EFECTO CRT
        </button>
      </div>
    </Popover>
  )
}

export function Header() {
  const song = useApp((s) => s.song)
  const playing = useApp((s) => s.playing)
  const recording = useApp((s) => s.recording)
  const loopPattern = useApp((s) => s.loopPattern)
  const metronome = useApp((s) => s.metronome)
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const undo = useApp((s) => s.undo)
  const redo = useApp((s) => s.redo)
  const edit = useApp((s) => s.edit)
  const notify = useApp((s) => s.notify)
  const set = useApp((s) => s.set)
  const taps = useRef<number[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [vol, setVol] = useState(90)

  const tap = () => {
    const now = performance.now()
    const t = taps.current
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0
    t.push(now)
    if (t.length > 6) t.shift()
    if (t.length >= 2) {
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1)
      const bpm = Math.round(60000 / avg)
      if (bpm >= 30 && bpm <= 300) edit((d) => (d.bpm = bpm), 'bpm')
    }
  }

  const share = async () => {
    const url = shareUrl(song)
    try {
      await navigator.clipboard.writeText(url)
      notify(`Enlace copiado · ${(url.length / 1024).toFixed(1)} KB`)
    } catch {
      window.prompt('Copia el enlace:', url)
    }
  }

  const openSong = () => set({ panel: 'song', inspectorOpen: true })

  return (
    <header className="hdr">
      <div className="brand">
        <Logo className="brand-logo" title="TZOOTZ" />
        <div className="brand-txt">
          <span className="brand-1">
            <span>
              TZOOTZ<i>▸</i>
            </span>
            <span>RESEARCH</span>
          </span>
          <span className="brand-2">CHIP CONSOLE · YM2612 + SN76489</span>
        </div>
      </div>

      <div className="tgroup" role="group" aria-label="Transporte">
        <button className="btn tbtn" onClick={() => void play(true)} title="Desde el principio (Enter)" aria-label="Desde el principio">
          {Icon.rewind}
        </button>
        <button className={cx('btn tbtn play', playing && 'on')} onClick={() => (playing ? stop() : void play())} title="Reproducir / parar (Espacio)" aria-label={playing ? 'Parar' : 'Reproducir'}>
          {playing ? Icon.stop : Icon.play}
        </button>
        <button className={cx('btn tbtn rec', recording && 'on')} onClick={toggleRecord} title="Grabar lo que toques en la pista seleccionada (R)" aria-label="Grabar" aria-pressed={recording}>
          <span className={cx('flex', recording && playing && 'blink')}>{Icon.rec}</span>
        </button>
        <button className={cx('btn tbtn', loopPattern && 'on')} onClick={toggleLoopPattern} title="Repetir solo el patrón seleccionado, sin pasar al siguiente (C)" aria-label="Bucle de patrón" aria-pressed={loopPattern}>
          {Icon.loop}
        </button>
        <button className={cx('btn tbtn', metronome && 'on')} onClick={toggleMetronome} title="Metrónomo" aria-label="Metrónomo" aria-pressed={metronome}>
          {Icon.metro}
        </button>
      </div>

      <div className="lcd">
        <Position />
        <span className="lcd-sep" />
        <label className="lcd-cell" title="Tempo · escribe un valor o marca el pulso con TAP">
          <small>BPM</small>
          <NumField className="v" value={song.bpm} min={30} max={300} onChange={(v) => edit((d) => (d.bpm = v), 'bpm')} label="Tempo en BPM" />
        </label>
        <button className="btn sm lcd-tap" onClick={tap} title="Marca el pulso con clics para fijar el tempo">
          TAP
        </button>
        <button className="lcd-cell lcd-opt lcd-sig" onClick={openSong} title="Compás · se cambia en CANCIÓN">
          <small>COMPÁS</small>
          <span className="v">{song.beatsPerBar}/4</span>
        </button>
        <button className="lcd-cell lcd-opt" onClick={openSong} title="Tonalidad y escala · se cambian en CANCIÓN">
          <small>TONO</small>
          <span className="v">
            {NOTE_NAMES[song.key]} {SCALE_SHORT[song.scale]}
          </span>
        </button>
        <span className="lcd-sep" />
        <TextField bare className="lcd-title" value={song.title} max={40} onChange={(v) => edit((d) => (d.title = v))} title="Título del tema" label="Título del tema" />
      </div>

      <div className="hdr-right">
        <label className="hdr-vol" title={`Volumen maestro · ${vol} %`}>
          <span className="label">VOL</span>
          <input
            type="range"
            className="rng"
            min={0}
            max={100}
            value={vol}
            style={{ '--fill': `${vol}%` } as CSSProperties}
            aria-label="Volumen maestro"
            onChange={(e) => {
              setVol(Number(e.target.value))
              engine.setVolume(Number(e.target.value) / 100)
            }}
          />
        </label>
        <div className="tgroup">
          <button className="btn icon" disabled={!canUndo} onClick={undo} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
            {Icon.undo}
          </button>
          <button className="btn icon" disabled={!canRedo} onClick={redo} title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">
            {Icon.redo}
          </button>
        </div>
        <div className="tgroup">
          <Settings />
          <button className="btn icon" onClick={() => setHelpOpen(true)} title="Ayuda y atajos" aria-label="Ayuda">
            {Icon.help}
          </button>
        </div>
        <button className="btn" onClick={() => set({ newSongOpen: true })} title="Tema nuevo: empieza de cero eligiendo tempo, tono, compás y sonidos" aria-label="Tema nuevo">
          {Icon.newFile} <span className="hdr-txt">NUEVO</span>
        </button>
        <button className="btn" onClick={() => void share()} title="Copia un enlace que contiene la canción entera" aria-label="Compartir">
          {Icon.share} <span className="hdr-txt hdr-txt-2">COMPARTIR</span>
        </button>
        <button className="btn primary" onClick={() => setExportOpen(true)} title="Exportar WAV / stems / MIDI / VGM / XGM…">
          {Icon.export} EXPORTAR
        </button>
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </header>
  )
}
