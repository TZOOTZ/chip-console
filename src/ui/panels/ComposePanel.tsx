// ── Panel COMPONER: generar temas, rellenar pistas, acordes y herramientas ───
import { useState } from 'react'
import { addNote, setTrackNotes } from '../../music/edit'
import { STYLES, generateSong, generateTrackNotes, type FillKind, type StyleId } from '../../music/generator'
import { getPattern, patternSteps, stepsPerBar, type Note } from '../../music/song'
import { CHORDS, NOTE_NAMES, SCALES, diatonicChord, snapToScale, type ChordType, type ScaleId } from '../../music/theory'
import { Rng } from '../../music/generator'
import { useApp } from '../../state/store'
import { engine } from '../../engine/client'
import { NumField, Section, Segmented } from '../controls'
import { cx } from '../util'
import { Icon } from '../icons'

const FILLS: { value: FillKind; label: string }[] = [
  { value: 'bass', label: 'BAJO' },
  { value: 'chords', label: 'ACORDES' },
  { value: 'arp', label: 'ARPEGIO' },
  { value: 'lead', label: 'MELODÍA' },
  { value: 'drums', label: 'BATERÍA' },
  { value: 'perc', label: 'PERCU' },
]

const PROGS: { name: string; degrees: [number, ChordType][] }[] = [
  { name: 'i · bVI · bVII · i', degrees: [[0, 'min'], [5, 'maj'], [6, 'maj'], [0, 'min']] },
  { name: 'i · iv · bVI · bVII', degrees: [[0, 'min'], [3, 'min'], [5, 'maj'], [6, 'maj']] },
  { name: 'Isus2 · bVI · bVII · i', degrees: [[0, 'sus2'], [5, 'maj7'], [6, 'sus2'], [0, 'min9']] },
  { name: 'I · V · vi · IV', degrees: [[0, 'maj'], [4, 'maj'], [5, 'min'], [3, 'maj']] },
  { name: 'i · bVII · bVI · V', degrees: [[0, 'min'], [6, 'maj'], [5, 'maj'], [4, 'maj']] },
  { name: 'ii · V · I · vi', degrees: [[1, 'min7'], [4, 'dom7'], [0, 'maj7'], [5, 'min7']] },
]

const DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

export function ComposePanel() {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  const selPattern = useApp((s) => s.selPattern)
  const edit = useApp((s) => s.edit)
  const replaceSong = useApp((s) => s.replaceSong)
  const selectPattern = useApp((s) => s.selectPattern)
  const notify = useApp((s) => s.notify)

  const [style, setStyle] = useState<StyleId>('cosmic')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 9000) + 100)
  const [bars, setBars] = useState(8)
  const [bpmAuto, setBpmAuto] = useState(true)
  const [bpm, setBpm] = useState(113)
  const [fill, setFill] = useState<FillKind>('lead')
  const [fillSeed, setFillSeed] = useState(1)
  const [chordDeg, setChordDeg] = useState(0)
  const [chordType, setChordType] = useState<ChordType | 'auto'>('auto')
  const [bar, setBar] = useState(1)

  const track = song.tracks[selTrack]
  const pattern = getPattern(song, selPattern) ?? song.patterns[0]
  const info = STYLES.find((s) => s.id === style)!

  const generate = (newSeed: number) => {
    const key = song.key
    const gen = generateSong({ style, seed: newSeed, key, bpm: bpmAuto ? undefined : bpm, bars })
    replaceSong(gen, { keepHistory: true })
    selectPattern(gen.patterns[0].id)
    useApp.getState().set({ dirty: true })
    notify(`Tema ${gen.title} generado · ${gen.bpm} BPM · Ctrl+Z para deshacer`)
  }

  const applyFill = (s: number) => {
    const notes = generateTrackNotes(song, pattern, track.id, fill, s, style)
    edit((d) => setTrackNotes(d, pattern.id, track.id, notes))
    notify(`${FILLS.find((f) => f.value === fill)?.label} → ${track.name}`)
  }

  const stampChord = (degree: number, type: ChordType | 'auto', atBar: number, progression?: [number, ChordType][]) => {
    const spb = stepsPerBar(song)
    const max = patternSteps(song, pattern)
    edit((d) => {
      const list: [number, ChordType | 'auto'][] = progression ?? [[degree, type]]
      list.forEach(([deg, ty], k) => {
        const start = ((atBar - 1) + k) * spb
        if (start >= max) return
        const c = diatonicChord(deg, d.key, d.scale, 48, false)
        const useType = ty === 'auto' ? c.type : ty
        const rootMidi = c.root
        const iv = CHORDS.find((x) => x.id === useType)?.intervals ?? [0, 4, 7]
        for (const n of iv) addNote(d, pattern.id, track.id, { step: start, len: spb, note: rootMidi + n + (track.kind === 'psg' ? 24 : 12), vel: 11 })
      })
    })
    void engine.preview(selTrack, 60 + song.key, 12)
  }

  /** variación suave de la pista: mueve algunas notas a vecinas de la escala y toca el ritmo */
  const mutate = () => {
    const rng = new Rng((Date.now() & 0xffffff) + 17)
    const max = patternSteps(song, pattern)
    const drum = track.kind === 'dac' || track.kind === 'noise'
    edit((d) => {
      const p = getPattern(d, selPattern)
      const arr = p?.notes[track.id]
      if (!p || !arr) return
      const out: Note[] = []
      for (const n of arr) {
        const r = rng.next()
        if (r < 0.06) continue // se pierde alguna nota
        const m = { ...n }
        if (!drum && r < 0.34) {
          const dir = rng.chance(0.5) ? 1 : -1
          let cand = snapToScale(m.note + dir, d.key, d.scale)
          if (cand === m.note) cand = snapToScale(m.note + dir * 2, d.key, d.scale)
          m.note = Math.max(0, Math.min(127, cand))
        }
        if (r > 0.9 && m.step + m.len < max) m.len += 1
        else if (r > 0.82 && m.len > 1) m.len -= 1
        if (drum && r > 0.94 && m.step + 1 < max) m.step += 1
        out.push(m)
      }
      p.notes[track.id] = out.sort((a, b) => a.step - b.step || a.note - b.note)
    })
    notify('Pista variada · Ctrl+Z para volver')
  }

  const humanize = () =>
    edit((d) => {
      const p = getPattern(d, selPattern)
      if (!p) return
      for (const t of d.tracks) for (const n of p.notes[t.id] ?? []) n.vel = Math.max(1, Math.min(15, n.vel + Math.round((Math.random() - 0.5) * 4)))
    })

  const transposePattern = (semis: number) =>
    edit((d) => {
      const p = getPattern(d, selPattern)
      if (!p) return
      for (const t of d.tracks) {
        if (t.kind === 'dac' || t.kind === 'noise') continue
        for (const n of p.notes[t.id] ?? []) n.note = Math.max(0, Math.min(127, n.note + semis))
      }
    })

  const reverse = () =>
    edit((d) => {
      const p = getPattern(d, selPattern)
      if (!p) return
      const max = patternSteps(d, p)
      for (const t of d.tracks) {
        const arr = p.notes[t.id]
        if (!arr) continue
        for (const n of arr) n.step = Math.max(0, max - n.step - n.len)
        arr.sort((a, b) => a.step - b.step || a.note - b.note)
      }
    })

  return (
    <div className="insp-grid">
      <Section title="1 · GENERAR TEMA COMPLETO">
        <div className="grid2">
          {STYLES.map((s) => (
            <button key={s.id} className={cx('btn', style === s.id && 'sel')} onClick={() => setStyle(s.id)} aria-pressed={style === s.id}>
              {s.name}
            </button>
          ))}
        </div>
        <p className="hint" style={{ minHeight: '1.8rem' }}>
          {info.blurb} · <b>{info.bpm[0]}–{info.bpm[1]} BPM</b>
        </p>
        <div className="flex flex-col gap-1">
          <span className="label">TÓNICA</span>
          <Segmented value={song.key} onChange={(k) => edit((d) => (d.key = k))} options={NOTE_NAMES.map((n, i) => ({ value: i, label: n }))} fill label="Tónica" />
        </div>
        <div className="row">
          <span className="label">COMPASES / SECCIÓN</span>
          <Segmented value={bars} onChange={setBars} options={[4, 8, 16].map((v) => ({ value: v, label: String(v) }))} label="Compases por sección" />
        </div>
        <div className="row">
          <button className={cx('btn sm', bpmAuto && 'on')} onClick={() => setBpmAuto(!bpmAuto)} aria-pressed={bpmAuto} title="Tempo típico del estilo; desactívalo para fijar el tuyo">
            BPM AUTO
          </button>
          {!bpmAuto && <NumField value={bpm} min={50} max={240} onChange={setBpm} width={52} label="BPM del tema generado" />}
          <span className="label ml-auto">SEMILLA</span>
          <NumField value={seed} min={1} max={99999} width={68} onChange={setSeed} label="Semilla" title="La misma semilla genera siempre el mismo tema" />
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
            {Icon.dice} OTRO
          </button>
          <button className="btn primary grow" onClick={() => generate(seed)}>
            GENERAR TEMA
          </button>
        </div>
      </Section>

      <Section title="2 · RELLENAR LA PISTA">
        <p className="hint">
          Escribe notas nuevas en <b>{track.id.toUpperCase()} {track.name}</b>, patrón <b>{pattern.name}</b>, sobre {NOTE_NAMES[song.key]} {SCALES.find((s) => s.id === song.scale)?.name.toLowerCase()}.
        </p>
        <div className="grid3">
          {FILLS.map((f) => (
            <button key={f.value} className={cx('btn', fill === f.value && 'sel')} onClick={() => setFill(f.value)} aria-pressed={fill === f.value}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button
            className="btn primary"
            onClick={() => {
              setFillSeed((s) => s + 1)
              applyFill(fillSeed + Math.floor(Math.random() * 1000))
            }}
          >
            {Icon.dice} RELLENAR
          </button>
          <span className="hint grow">Otra pulsación, otra variación.</span>
        </div>
      </Section>

      <Section title="3 · ACORDES Y PROGRESIONES">
        <div className="row">
          <span className="label">GRADO</span>
          <Segmented value={chordDeg} onChange={setChordDeg} options={DEGREES.map((r, i) => ({ value: i, label: r }))} label="Grado del acorde" />
        </div>
        <div className="row">
          <span className="label">TIPO</span>
          <select className="field sm" value={chordType} onChange={(e) => setChordType(e.target.value as ChordType | 'auto')} aria-label="Tipo de acorde">
            <option value="auto">diatónico</option>
            {CHORDS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
          <span className="label">COMPÁS</span>
          <NumField value={Math.min(bar, pattern.bars)} min={1} max={pattern.bars} onChange={setBar} width={40} label="Compás donde insertar" />
          <button className="btn grow" onClick={() => stampChord(chordDeg, chordType, Math.min(bar, pattern.bars))}>
            INSERTAR
          </button>
        </div>
        <div className="sep" />
        <span className="label">PROGRESIONES · desde el compás indicado</span>
        <div className="grid2">
          {PROGS.map((p) => (
            <button key={p.name} className="btn sm prog" onClick={() => stampChord(0, 'auto', Math.min(bar, pattern.bars), p.degrees)}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="hint">Cada pista es una sola voz del chip: el acorde suena como arpegio rápido, al estilo de la época.</p>
      </Section>

      <Section title="4 · HERRAMIENTAS">
        <div className="row">
          <span className="label">ESCALA</span>
          <select className="field sm grow" value={song.scale} onChange={(e) => edit((d) => (d.scale = e.target.value as ScaleId))} aria-label="Escala">
            {SCALES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span className="label">TRANSPONER</span>
          <div className="seg" role="group" aria-label="Transponer el patrón">
            <button onClick={() => transposePattern(-12)} title="Una octava abajo">
              −8ª
            </button>
            <button onClick={() => transposePattern(-1)} title="Un semitono abajo">
              −1
            </button>
            <button onClick={() => transposePattern(1)} title="Un semitono arriba">
              +1
            </button>
            <button onClick={() => transposePattern(12)} title="Una octava arriba">
              +8ª
            </button>
          </div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={humanize} title="Varía un poco la velocidad de cada nota">
            HUMANIZAR
          </button>
          <button className="btn sm" onClick={reverse} title="Invierte el patrón en el tiempo">
            INVERTIR
          </button>
          <button className="btn sm grow" onClick={mutate} title="Varía la pista seleccionada: notas vecinas, duraciones y alguna omisión">
            {Icon.dice} VARIAR PISTA
          </button>
        </div>
        <p className="hint">Transponer afecta a todas las pistas melódicas del patrón seleccionado.</p>
      </Section>
    </div>
  )
}
