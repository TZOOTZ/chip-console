// ── Panel RECURSOS: piezas de juego y figuras de composición ────────────────
import { useState } from 'react'
import { FIGURES, applyFigure, type FigureGroup, type FigureId, type FigureResult } from '../../music/figuras'
import { PIECES, generatePiece, type PieceId, type PieceMode } from '../../music/piezas'
import { getPattern } from '../../music/song'
import { NOTE_NAMES } from '../../music/theory'
import { useApp } from '../../state/store'
import { NumField, Section, Segmented } from '../controls'
import { Icon } from '../icons'
import { cx } from '../util'

const GROUPS: FigureGroup[] = ['RETÓRICA', 'ADORNO', 'TEXTURA', 'ARTICULACIÓN']
const MODES: { value: PieceMode; label: string; title: string }[] = [
  { value: 'auto', label: 'AUTO', title: 'El modo en el que está escrita cada pieza' },
  { value: 'major', label: 'MAYOR', title: 'Siempre en mayor' },
  { value: 'minor', label: 'MENOR', title: 'Siempre en menor, con la sensible en la dominante' },
]

export function ResourcesPanel() {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  const selPattern = useApp((s) => s.selPattern)
  const selNotes = useApp((s) => s.selNotes)
  const edit = useApp((s) => s.edit)
  const replaceSong = useApp((s) => s.replaceSong)
  const selectPattern = useApp((s) => s.selectPattern)
  const setSelNotes = useApp((s) => s.setSelNotes)
  const notify = useApp((s) => s.notify)

  const [piece, setPiece] = useState<PieceId>('fanfare')
  const [mode, setMode] = useState<PieceMode>('auto')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 9000) + 100)
  const [last, setLast] = useState<FigureId | null>(null)

  const info = PIECES.find((p) => p.id === piece)!
  const track = song.tracks[selTrack]
  const pattern = getPattern(song, selPattern) ?? song.patterns[0]
  const drums = track.kind === 'dac' || track.kind === 'noise'
  const lastInfo = FIGURES.find((f) => f.id === last)

  const generate = (s: number) => {
    const gen = generatePiece({ piece, seed: s, key: song.key, mode })
    replaceSong(gen, { keepHistory: true })
    selectPattern(gen.patterns[0].id)
    useApp.getState().set({ dirty: true })
    notify(`${gen.title} · ${info.meter} · ${gen.bpm} BPM · Ctrl+Z para deshacer`)
  }

  const figure = (id: FigureId) => {
    let res: FigureResult = { ok: false, message: '' }
    edit((d) => {
      res = applyFigure(d, pattern.id, track.id, selNotes, id)
    })
    if (res.ok) setSelNotes([])
    setLast(id)
    notify(res.ok ? `${res.message} · Ctrl+Z para deshacer` : res.message)
  }

  return (
    <div className="insp-grid">
      <Section title="PIEZAS DE JUEGO">
        <div className="grid3">
          {PIECES.map((p) => (
            <button key={p.id} className={cx('btn', piece === p.id && 'sel')} onClick={() => setPiece(p.id)} aria-pressed={piece === p.id}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="hint" style={{ minHeight: '2.7rem' }}>
          {info.blurb} · <b>{info.meter}</b> · <b>{info.tempo}</b>
        </p>
        <div className="flex flex-col gap-1">
          <span className="label">TÓNICA</span>
          <Segmented value={song.key} onChange={(k) => edit((d) => (d.key = k))} options={NOTE_NAMES.map((n, i) => ({ value: i, label: n }))} fill label="Tónica" />
        </div>
        <div className="row">
          <span className="label">MODO</span>
          <Segmented value={mode} onChange={setMode} options={MODES} label="Modo de la pieza" />
          <span className="label ml-auto">SEMILLA</span>
          <NumField value={seed} min={1} max={99999} width={68} onChange={setSeed} label="Semilla" title="La misma semilla genera siempre la misma pieza" />
        </div>
        <div className="row">
          <button
            className="btn"
            title="Semilla nueva al azar y generar"
            onClick={() => {
              const s = Math.floor(Math.random() * 99000) + 100
              setSeed(s)
              generate(s)
            }}
          >
            {Icon.dice} OTRA
          </button>
          <button className="btn primary grow" onClick={() => generate(seed)}>
            GENERAR {info.name}
          </button>
        </div>
        <p className="hint">Crea un tema nuevo en lugar del actual (Ctrl+Z lo recupera).</p>
      </Section>

      <Section title="FIGURAS">
        <p className="hint">
          Sobre <b>{track.id.toUpperCase()} {track.name}</b> en el patrón <b>{pattern.name}</b>:{' '}
          {selNotes.length ? (
            <b>
              {selNotes.length} nota{selNotes.length === 1 ? '' : 's'} seleccionada{selNotes.length === 1 ? '' : 's'}
            </b>
          ) : (
            'sin selección (el primer compás como motivo, o toda la pista)'
          )}
          .
        </p>
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <span className="label">{g}</span>
            <div className="grid3">
              {FIGURES.filter((f) => f.group === g).map((f) => (
                <button
                  key={f.id}
                  className={cx('btn sm', last === f.id && 'sel')}
                  onClick={() => figure(f.id)}
                  disabled={drums && !f.drums}
                  title={f.blurb}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="hint" style={{ minHeight: '2.7rem' }}>
          {lastInfo ? (
            <>
              <b>{lastInfo.name}</b> · {lastInfo.blurb}
            </>
          ) : drums ? (
            'En una pista de batería solo sirven ANÁFORA y OSTINATO.'
          ) : (
            'Cada figura se aplica al pulsarla; Ctrl+Z la deshace. Selecciona notas en el piano roll para elegir el motivo.'
          )}
        </p>
      </Section>
    </div>
  )
}
