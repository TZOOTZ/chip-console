// ── Lista de canales del chip: selección, mute/solo, instrumento, panorama y nivel ─
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { engine } from '../engine/client'
import { clearMuteSolo } from '../state/controller'
import { useApp } from '../state/store'
import type { Track } from '../music/song'
import { BarSlider } from './controls'
import { KIND_COLOR, KIND_TAG, cx } from './util'

const tagOf = (t: Track): string => `${KIND_TAG[t.kind]}${t.kind === 'noise' ? '' : t.ch + 1}`

/** vúmetro vertical: lo mueve el motor directamente, sin pasar por React */
function Vu({ index }: { index: number }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    let level = 0
    return engine.onStatus((s) => {
      const v = s.meters[index] ?? 0
      level = Math.max(v, level * 0.82)
      if (ref.current) ref.current.style.height = `${Math.min(100, level * 100)}%`
    })
  }, [index])
  return (
    <div className="trk-vu" aria-hidden>
      <i ref={ref} />
    </div>
  )
}

const Row = memo(function Row({ track, index, selected, bank }: { track: Track; index: number; selected: boolean; bank: { name: string }[] | null }) {
  const edit = useApp((s) => s.edit)
  const selectTrack = useApp((s) => s.selectTrack)
  const [renaming, setRenaming] = useState(false)

  const patch = (fn: (t: Track) => void, key?: string) =>
    edit((d) => {
      const t = d.tracks[index]
      if (t) fn(t)
    }, key)

  return (
    <div className={cx('trk', selected && 'sel', track.mute && 'muted')} style={{ '--tc': KIND_COLOR[track.kind] } as CSSProperties} onPointerDown={() => selectTrack(index)}>
      <div className="trk-top">
        <span className="trk-tag" title={`Pista ${index + 1} · tecla ${index === 9 ? 0 : index + 1}`}>
          {tagOf(track)}
        </span>
        {renaming ? (
          <input
            autoFocus
            className="field sm trk-rename"
            defaultValue={track.name}
            maxLength={12}
            aria-label="Nombre de la pista"
            onBlur={(e) => {
              setRenaming(false)
              patch((t) => (t.name = e.target.value.trim().slice(0, 12) || t.name))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'Escape') setRenaming(false)
              e.stopPropagation()
            }}
          />
        ) : (
          <button className="trk-name" onDoubleClick={() => setRenaming(true)} title="Doble clic para renombrar">
            {track.name}
          </button>
        )}
        <button className={cx('btn sm icon mute', track.mute && 'on')} title={`Silenciar (Shift + ${index === 9 ? 0 : index + 1})`} aria-label={`Silenciar ${track.name}`} aria-pressed={track.mute} onClick={() => patch((t) => (t.mute = !t.mute))}>
          M
        </button>
        <button className={cx('btn sm icon solo', track.solo && 'on')} title={`Solo (Alt + ${index === 9 ? 0 : index + 1})`} aria-label={`Solo ${track.name}`} aria-pressed={track.solo} onClick={() => patch((t) => (t.solo = !t.solo))}>
          S
        </button>
      </div>
      <div className="trk-mid">
        {bank ? (
          <select className="field sm" value={track.inst} onChange={(e) => patch((t) => (t.inst = Number(e.target.value)))} title="Instrumento" aria-label={`Instrumento de ${track.name}`}>
            {bank.map((p, i) => (
              <option key={i} value={i}>
                {String(i + 1).padStart(2, '0')} {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="trk-kit">{track.kind === 'dac' ? 'KIT PCM · DAC' : 'KIT DE RUIDO'}</span>
        )}
        {(track.kind === 'fm' || track.kind === 'dac') && (
          <button className="btn sm icon" title="Panorama: centro / izquierda / derecha" aria-label={`Panorama de ${track.name}`} onClick={() => patch((t) => (t.pan = t.pan === 'C' ? 'L' : t.pan === 'L' ? 'R' : 'C'))}>
            {track.pan}
          </button>
        )}
        {track.id === 'ch6' && (
          <button
            className="btn sm icon"
            title="El canal 6 es FM o DAC: cambia entre batería PCM y un sexto canal FM"
            aria-label="Cambiar el canal 6 entre PCM y FM"
            onClick={() => {
              // las notas de batería (índices 0-7) y de FM (0-127) no son intercambiables: se vacía la pista
              edit((d) => {
                const t = d.tracks[index]
                t.kind = t.kind === 'dac' ? 'fm' : 'dac'
                t.inst = 0
                t.name = t.kind === 'dac' ? 'DRUMS' : 'FM 6'
                for (const p of d.patterns) p.notes[t.id] = []
              })
              useApp.getState().notify('FM6 ⇄ PCM: la pista se ha vaciado (Ctrl+Z para recuperar)')
            }}
          >
            ⇄
          </button>
        )}
        <BarSlider className="trk-vol" value={track.vol} min={0} max={100} def={100} color="color-mix(in srgb, var(--tc) 42%, transparent)" title={`Volumen ${track.vol} · arrastra · doble clic = 100`} label={`Volumen de ${track.name}`} onChange={(v) => patch((t) => (t.vol = v), `vol-${index}`)} />
      </div>
      <Vu index={index} />
    </div>
  )
})

export function TrackList() {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  return (
    <aside className="trks" aria-label="Canales">
      <div className="pane-h">
        <span className="title-px">CANALES</span>
        {song.tracks.some((t) => t.mute || t.solo) ? (
          <button className="btn sm" onClick={clearMuteSolo} title="Quitar todos los mute y solo (Alt + M)" aria-label="Quitar mute y solo">
            M/S ✕
          </button>
        ) : (
          <span className="label">6 FM · 4 PSG</span>
        )}
      </div>
      <div className="trks-list">
        {song.tracks.map((t, i) => (
          <Row key={t.id} track={t} index={i} selected={i === selTrack} bank={t.kind === 'fm' ? song.fmBank : t.kind === 'psg' ? song.psgBank : null} />
        ))}
      </div>
    </aside>
  )
}

/** Versión compacta (móvil): chips horizontales con selección, mute y solo. */
export function TrackStrip() {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  const selectTrack = useApp((s) => s.selectTrack)
  const edit = useApp((s) => s.edit)
  return (
    <div className="trk-strip" aria-label="Canales">
      {song.tracks.map((t, i) => (
        <div key={t.id} className={cx('trk-chip', i === selTrack && 'sel')} style={{ '--tc': KIND_COLOR[t.kind] } as CSSProperties}>
          <button className="trk-chip-name" onClick={() => selectTrack(i)}>
            <span className="trk-tag">{tagOf(t)}</span>
            {t.name}
          </button>
          <button className={cx('btn sm icon mute', t.mute && 'on')} aria-label={`Silenciar ${t.name}`} onClick={() => edit((d) => (d.tracks[i].mute = !d.tracks[i].mute))}>
            M
          </button>
          <button className={cx('btn sm icon solo', t.solo && 'on')} aria-label={`Solo ${t.name}`} onClick={() => edit((d) => (d.tracks[i].solo = !d.tracks[i].solo))}>
            S
          </button>
        </div>
      ))}
    </div>
  )
}
