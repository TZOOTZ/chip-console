// ── Articulación de la pista: cuánto se sostiene cada nota y el portamento de las ligadas ──
import { useApp } from '../../state/store'
import { Section, Slider } from '../controls'

/** frames (60 Hz) → milisegundos redondeados */
const ms = (frames: number): number => Math.round((frames * 1000) / 60)

export function TrackArticulation({ color }: { color?: string }) {
  const selTrack = useApp((s) => s.selTrack)
  const gate = useApp((s) => s.song.tracks[s.selTrack].gate)
  const glide = useApp((s) => s.song.tracks[s.selTrack].glide)
  const edit = useApp((s) => s.edit)
  return (
    <Section title="ARTICULACIÓN" right={<span className="label">DE LA PISTA</span>}>
      <Slider
        label="GATE"
        title="Cuánto suena cada nota respecto a lo que dura escrita: bajo = picado · 100 % = pegada a la siguiente"
        value={Math.round(gate * 100)}
        min={10}
        max={100}
        def={92}
        color={color}
        format={(v) => `${v}%`}
        onChange={(v) => edit((d) => (d.tracks[selTrack].gate = v / 100), `gate-${selTrack}`)}
      />
      <Slider
        label="GLIDE"
        title="Portamento de las notas ligadas: lo que tarda el tono en llegar a la nota nueva (OFF = salta de golpe, sin re-ataque)"
        value={glide}
        min={0}
        max={30}
        def={0}
        color={color}
        format={(v) => (v === 0 ? 'OFF' : `${ms(v)} ms`)}
        onChange={(v) => edit((d) => (d.tracks[selTrack].glide = v), `glide-${selTrack}`)}
      />
      <p className="hint">
        Para ligar notas, selecciónalas en el piano roll y pulsa <b>LIGAR</b> (tecla B).
      </p>
    </Section>
  )
}
