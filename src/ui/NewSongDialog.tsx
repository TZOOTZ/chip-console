// ── Diálogo TEMA NUEVO: empezar de cero eligiendo sonidos, tempo, compás y tono ─
import { useMemo, useState, type CSSProperties } from 'react'
import { STYLES, createBlankSong, type PaletteId } from '../music/generator'
import type { Song, Track } from '../music/song'
import { NOTE_NAMES, SCALES, type ScaleId } from '../music/theory'
import { stop } from '../state/controller'
import { saveToLibrary } from '../state/persist'
import { useApp } from '../state/store'
import { Modal, NumField, Segmented } from './controls'
import { Icon } from './icons'
import { KIND_COLOR, cx } from './util'

const PALETTES: { id: PaletteId; name: string }[] = [{ id: 'basic', name: 'BÁSICO' }, ...STYLES.map((s) => ({ id: s.id as PaletteId, name: s.name }))]

/** nombre del sonido que lleva la pista (los kits de batería y de ruido no tienen instrumento) */
function soundOf(song: Song, t: Track): string {
  if (t.kind === 'fm') return song.fmBank[t.inst]?.name ?? ''
  if (t.kind === 'psg') return song.psgBank[t.inst]?.name ?? ''
  return t.kind === 'dac' ? 'KIT PCM' : 'KIT RUIDO'
}

function Form({ onClose }: { onClose: () => void }) {
  const current = useApp((s) => s.song)
  const [palette, setPalette] = useState<PaletteId>('basic')
  const [title, setTitle] = useState('TEMA NUEVO')
  const [bpm, setBpm] = useState(120)
  const [beats, setBeats] = useState(4)
  const [key, setKey] = useState(current.key)
  const [scale, setScale] = useState<ScaleId>('minor')
  const [bars, setBars] = useState(4)
  const [keep, setKeep] = useState(false)

  // el reparto de pistas solo depende de la paleta (y de la tónica: hay kits afinados)
  const preview = useMemo(() => createBlankSong({ bpm: 120, beatsPerBar: 4, key, scale: 'minor', bars: 4, palette }), [palette, key])

  const pick = (id: PaletteId) => {
    setPalette(id)
    const info = STYLES.find((s) => s.id === id)
    if (!info) return
    // cada estilo trae su tempo y su escala de partida; después se pueden cambiar
    setBpm(Math.round((info.bpm[0] + info.bpm[1]) / 2))
    setScale(info.scale)
  }

  const create = () => {
    const st = useApp.getState()
    if (keep) saveToLibrary(st.song)
    if (st.playing) stop()
    const song = createBlankSong({ title, bpm, beatsPerBar: beats, key, scale, bars, palette })
    st.replaceSong(song, { keepHistory: true })
    useApp.getState().set({ selPattern: song.patterns[0].id, selTrack: 0, selNotes: [], panel: 'compose', inspectorOpen: true, dirty: true, newSongOpen: false })
    st.notify(`«${song.title}» en blanco · Ctrl+Z recupera el tema anterior`)
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        create()
      }}
    >
      <p className="modal-p">Un patrón vacío y los sonidos que elijas ya repartidos por las diez pistas. Después escribe en el piano roll, toca con el teclado o usa RELLENAR para arrancar una idea.</p>

      <div className="flex flex-col gap-1">
        <span className="label">SONIDOS</span>
        <div className="new-pals" role="radiogroup" aria-label="Sonidos de partida">
          {PALETTES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={palette === p.id} className={cx('btn', palette === p.id && 'sel')} onClick={() => pick(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="new-trks" aria-label="Reparto de pistas">
          {preview.tracks.map((t) => (
            <span key={t.id} className="new-trk" style={{ '--tc': KIND_COLOR[t.kind] } as CSSProperties}>
              <b>{t.name}</b>
              <small>{soundOf(preview, t)}</small>
            </span>
          ))}
        </div>
      </div>

      <div className="form">
        <span className="label">TÍTULO</span>
        <input
          className="field"
          value={title}
          maxLength={40}
          spellCheck={false}
          aria-label="Título del tema"
          // showModal() enfoca el elemento marcado con el atributo (React no lo escribe en el DOM)
          ref={(el) => {
            el?.setAttribute('autofocus', '')
          }}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <span className="label">TEMPO</span>
        <div className="row">
          <NumField value={bpm} min={30} max={300} onChange={setBpm} width={56} label="Tempo en BPM" />
          <span className="label">BPM</span>
          <span className="label ml-auto">COMPÁS</span>
          <Segmented value={beats} onChange={setBeats} options={[2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}/4` }))} label="Compás" />
        </div>
        <span className="label">TÓNICA</span>
        <Segmented value={key} onChange={setKey} options={NOTE_NAMES.map((n, i) => ({ value: i, label: n }))} fill label="Tónica" />
        <span className="label">ESCALA</span>
        <select className="field" value={scale} onChange={(e) => setScale(e.target.value as ScaleId)} aria-label="Escala">
          {SCALES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="label">COMPASES</span>
        <div className="row">
          <Segmented value={bars} onChange={setBars} options={[2, 4, 8, 16].map((n) => ({ value: n, label: String(n) }))} label="Compases del primer patrón" />
          <span className="hint grow">del primer patrón · luego añades los que quieras</span>
        </div>
      </div>

      <div className="row new-foot">
        <button type="button" className={cx('btn sm', keep && 'on')} aria-pressed={keep} onClick={() => setKeep(!keep)} title="Guarda el tema que tienes abierto en la biblioteca local antes de empezar el nuevo">
          GUARDAR ANTES EL ACTUAL
        </button>
        <span className="hint grow">«{current.title}» se recupera con Ctrl+Z.</span>
        <button type="button" className="btn" onClick={onClose}>
          CANCELAR
        </button>
        <button type="submit" className="btn primary">
          {Icon.plus} CREAR TEMA
        </button>
      </div>
    </form>
  )
}

export function NewSongDialog() {
  const open = useApp((s) => s.newSongOpen)
  const set = useApp((s) => s.set)
  const close = () => set({ newSongOpen: false })
  return (
    <Modal open={open} onClose={close} title="TEMA NUEVO" width={640}>
      <Form onClose={close} />
    </Modal>
  )
}
