// ── Inspector: COMPONER / INSTRUMENTO / CANCIÓN, acoplado a la derecha o abajo ─
import { useRef, useState } from 'react'
import { useApp, type PanelId } from '../state/store'
import { Modal } from './controls'
import { Icon } from './icons'
import { ComposePanel } from './panels/ComposePanel'
import { FmEditor } from './panels/FmEditor'
import { DrumEditor, NoiseEditor, PsgEditor } from './panels/KitEditors'
import { SongPanel } from './panels/SongPanel'
import { cx, capturePointer, rem } from './util'

const TABS: { id: PanelId; label: string; title: string }[] = [
  { id: 'compose', label: 'COMPONER', title: 'Generar temas, rellenar pistas, acordes y herramientas' },
  { id: 'inst', label: 'INSTRUMENTO', title: 'Sonido de la pista seleccionada' },
  { id: 'song', label: 'CANCIÓN', title: 'Tempo, tonalidad, proyectos, MIDI y exportación' },
]

/** altura mínima y por defecto del panel inferior (px de diseño) */
const MIN_H = 120
const DEF_H = 230

function InstrumentPanel() {
  const kind = useApp((s) => s.song.tracks[s.selTrack].kind)
  switch (kind) {
    case 'fm':
      return <FmEditor />
    case 'psg':
      return <PsgEditor />
    case 'noise':
      return <NoiseEditor />
    default:
      return <DrumEditor />
  }
}

export function Inspector({ dock }: { dock: 'right' | 'bottom' }) {
  const panel = useApp((s) => s.panel)
  const open = useApp((s) => s.inspectorOpen)
  const panelH = useApp((s) => s.panelH)
  const set = useApp((s) => s.set)
  const trackId = useApp((s) => s.song.tracks[s.selTrack].id)
  const trackName = useApp((s) => s.song.tracks[s.selTrack].name)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const right = dock === 'right'

  const pick = (id: PanelId) => set({ panel: id, inspectorOpen: true })

  // contraído a la derecha: una regleta con las pestañas en vertical
  if (right && !open) {
    return (
      <aside className="insp right closed" aria-label="Panel de herramientas (contraído)">
        <div className="insp-rail">
          <button className="btn sm icon ghost" onClick={() => set({ inspectorOpen: true })} title="Abrir el panel" aria-label="Abrir el panel">
            {Icon.left}
          </button>
          {TABS.map((t) => (
            <button key={t.id} className={cx('vtab', panel === t.id && 'on')} onClick={() => pick(t.id)} title={t.title}>
              {t.label}
            </button>
          ))}
        </div>
      </aside>
    )
  }

  const maxH = () => Math.round((window.innerHeight * 0.7) / useApp.getState().scale)

  return (
    <aside className={cx('insp', dock)} style={!right && open ? { height: rem(panelH) } : undefined} aria-label="Panel de herramientas">
      {!right && (
        <div
          className="grip-h"
          title="Arrastra para cambiar la altura · doble clic: contraer / abrir"
          onPointerDown={(e) => {
            capturePointer(e)
            drag.current = { y: e.clientY, h: open ? panelH : 0 }
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            const h = drag.current.h + (drag.current.y - e.clientY) / useApp.getState().scale
            if (h < MIN_H * 0.5) set({ inspectorOpen: false })
            else set({ inspectorOpen: true, panelH: Math.max(MIN_H, Math.min(maxH(), Math.round(h))) })
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={() => set(open ? { inspectorOpen: false } : { inspectorOpen: true, panelH: Math.max(panelH, DEF_H) })}
        />
      )}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={open && panel === t.id} className={cx('tab', open && panel === t.id && 'on')} onClick={() => pick(t.id)} title={t.title}>
            {t.label}
            {t.id === 'inst' && !right && <i> · {trackId.toUpperCase()}</i>}
          </button>
        ))}
        <span className="tabs-end">
          {panel === 'inst' && open && (
            <button className="btn sm icon ghost" title="Abrir el editor de instrumento en una ventana grande" aria-label="Ampliar el editor" onClick={() => setExpanded(true)}>
              {Icon.expand}
            </button>
          )}
          <button className="btn sm icon ghost" title={open ? 'Contraer el panel' : 'Abrir el panel'} aria-label={open ? 'Contraer el panel' : 'Abrir el panel'} onClick={() => set({ inspectorOpen: !open })}>
            {right ? Icon.right : open ? Icon.down : Icon.up}
          </button>
        </span>
      </div>
      {open && (
        <div className="insp-body">
          {panel === 'compose' && <ComposePanel />}
          {panel === 'inst' && <InstrumentPanel />}
          {panel === 'song' && <SongPanel />}
        </div>
      )}
      <Modal open={expanded} onClose={() => setExpanded(false)} title={`INSTRUMENTO · ${trackId.toUpperCase()} ${trackName}`} width={1180}>
        <InstrumentPanel />
      </Modal>
    </aside>
  )
}
