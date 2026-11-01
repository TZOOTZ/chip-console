// ── Panel CANCIÓN: ajustes, proyectos, compartir y exportar ──────────────────
import { useState, type CSSProperties } from 'react'
import { shareUrl } from '../../export/share'
import { importFileToApp } from '../../state/importer'
import { songSeconds } from '../../music/song'
import { SCALES, NOTE_NAMES, type ScaleId } from '../../music/theory'
import { disableMidi, enableMidi, midiSupported } from '../../state/midi'
import { deleteFromLibrary, listLibrary, loadFromLibrary, saveToLibrary, type LibraryEntry } from '../../state/persist'
import { useApp } from '../../state/store'
import { NumField, Section, Segmented, TextField } from '../controls'
import { ExportDialog } from '../ExportDialog'
import { Icon } from '../icons'
import { cx } from '../util'

export function SongPanel() {
  const song = useApp((s) => s.song)
  const edit = useApp((s) => s.edit)
  const notify = useApp((s) => s.notify)
  const replaceSong = useApp((s) => s.replaceSong)
  const set = useApp((s) => s.set)
  const midiDevices = useApp((s) => s.midiDevices)
  const [lib, setLib] = useState<LibraryEntry[]>(() => listLibrary())
  const [exportOpen, setExportOpen] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const secs = songSeconds(song)
  const swing = Math.round(song.swing * 100)

  const save = () => {
    saveToLibrary(song)
    setLib(listLibrary())
    notify('Guardado en el navegador')
  }

  const copyLink = async () => {
    const url = shareUrl(song)
    try {
      await navigator.clipboard.writeText(url)
      notify(`Enlace copiado (${(url.length / 1024).toFixed(1)} KB)`)
    } catch {
      window.prompt('Copia el enlace:', url)
    }
  }

  return (
    <div className="insp-grid">
      <Section title="TEMA">
        <div className="form">
          <span className="label">TÍTULO</span>
          <TextField value={song.title} max={40} onChange={(v) => edit((d) => (d.title = v))} label="Título" />
          <span className="label">AUTOR</span>
          <TextField value={song.author} max={40} onChange={(v) => edit((d) => (d.author = v))} placeholder="TZOOTZ RESEARCH" label="Autor" />
          <span className="label">TEMPO</span>
          <div className="row">
            <NumField value={song.bpm} min={30} max={300} onChange={(v) => edit((d) => (d.bpm = v), 'bpm')} width={52} label="Tempo en BPM" />
            <span className="label">BPM</span>
            <span className="label ml-auto">COMPÁS</span>
            <select className="field sm" value={song.beatsPerBar} onChange={(e) => edit((d) => (d.beatsPerBar = Number(e.target.value)))} aria-label="Compás">
              {[2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}/4
                </option>
              ))}
            </select>
          </div>
          <span className="label">SWING</span>
          <div className="row">
            <Segmented
              value={song.swingGrid === 4 ? 4 : 2}
              onChange={(g) => edit((d) => (d.swingGrid = g))}
              options={[
                { value: 2, label: '1/16', title: 'El swing balancea parejas de semicorcheas (shuffle de funk y hip-hop)' },
                { value: 4, label: '1/8', title: 'El swing balancea parejas de corcheas (jazz: con 33 % sale el 2:1 de tresillo)' },
              ]}
              label="El swing balancea"
            />
            <input
              type="range"
              className="rng grow"
              min={0}
              max={50}
              value={swing}
              style={{ '--fill': `${swing * 2}%` } as CSSProperties}
              aria-label="Swing"
              onChange={(e) => edit((d) => (d.swing = Number(e.target.value) / 100), 'swing')}
              onDoubleClick={() => edit((d) => (d.swing = 0))}
            />
            <span className="num" style={{ width: '2.5rem', textAlign: 'right' }}>
              {swing}%
            </span>
          </div>
          <span className="label">TONO</span>
          <div className="row">
            <select className="field sm" value={song.key} onChange={(e) => edit((d) => (d.key = Number(e.target.value)))} aria-label="Tónica">
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
            <select className="field sm grow" value={song.scale} onChange={(e) => edit((d) => (d.scale = e.target.value as ScaleId))} aria-label="Escala">
              {SCALES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint">
          Duración <b>{Math.floor(secs / 60)}:{String(Math.round(secs % 60)).padStart(2, '0')}</b> · {song.patterns.length} patrones · {song.order.length} bloques en el orden
        </p>
      </Section>

      <Section title="EXPORTAR Y COMPARTIR">
        <div className="grid2">
          <button className="btn primary" onClick={() => setExportOpen(true)}>
            {Icon.export} EXPORTAR…
          </button>
          <button className="btn" onClick={() => void copyLink()} title="La canción entera viaja dentro de la URL">
            {Icon.share} COPIAR ENLACE
          </button>
        </div>
        <p className="hint">WAV y stems por canal para tu DAW · MIDI · VGM/VGZ/XGM (suena igual en la consola real y en emuladores) · proyecto JSON.</p>
        <div className="sep" />
        <div className="grid2">
          <label className="btn" style={{ cursor: 'pointer' }}>
            IMPORTAR…
            <input
              type="file"
              accept=".json,.tzmd.json,.mid,.midi,.vgm,.vgz,application/json,audio/midi"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void importFileToApp(f)
              }}
            />
          </label>
          <button className="btn" onClick={() => set({ newSongOpen: true })} title="Empieza un tema de cero: eliges tempo, tono, compás y sonidos">
            {Icon.plus} TEMA NUEVO…
          </button>
        </div>
      </Section>

      <Section
        title="BIBLIOTECA LOCAL"
        right={
          <button className="btn sm primary" onClick={save} title="Guarda el tema en este navegador (Ctrl+S)">
            GUARDAR
          </button>
        }
      >
        <div className="lib">
          {lib.length === 0 && <p className="hint">Aún no hay proyectos guardados. El último se autoguarda siempre.</p>}
          {lib.map((e) => (
            <div key={e.id} className="lib-row">
              <span className="lib-name" title={e.name}>
                {e.name}
              </span>
              <span className="label">{new Date(e.updated).toLocaleDateString()}</span>
              <button
                className="btn sm"
                onClick={() => {
                  const s = loadFromLibrary(e.id)
                  if (s) {
                    replaceSong(s, { keepHistory: true })
                    notify(`«${s.title}» cargado`)
                  }
                }}
              >
                ABRIR
              </button>
              <button
                className="btn sm icon danger"
                title="Borrar de la biblioteca"
                aria-label={`Borrar ${e.name}`}
                onClick={() => {
                  deleteFromLibrary(e.id)
                  setLib(listLibrary())
                }}
              >
                {Icon.trash}
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="ENTRADA MIDI">
        <div className="row">
          <button
            className={cx('btn', midiOn && 'on')}
            disabled={!midiSupported()}
            aria-pressed={midiOn}
            onClick={async () => {
              if (midiOn) {
                disableMidi()
                setMidiOn(false)
                set({ midiDevices: [] })
                return
              }
              const ok = await enableMidi((names) => set({ midiDevices: names }))
              setMidiOn(ok)
              if (!ok) notify('MIDI no disponible o permiso denegado')
            }}
          >
            MIDI IN {midiOn ? 'ON' : 'OFF'}
          </button>
          <span className="hint grow">{!midiSupported() ? 'Tu navegador no soporta Web MIDI' : midiDevices.length ? midiDevices.join(', ') : 'Sin dispositivos conectados'}</span>
        </div>
        <p className="hint">Un teclado MIDI toca la pista seleccionada; con ● REC armado, lo que toques se graba cuantizado a la rejilla.</p>
      </Section>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}
