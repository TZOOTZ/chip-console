// ── Editores de instrumentos PSG, kit de ruido y kit de batería PCM ──────────
import type { CSSProperties } from 'react'
import { engine } from '../../engine/client'
import { PSG_PRESETS } from '../../music/presets'
import type { DrumKind, PsgInst } from '../../music/song'
import { noteName } from '../../music/theory'
import { useApp } from '../../state/store'
import { Knob, Section, Segmented, Slider, TextField } from '../controls'
import { Icon } from '../icons'
import { TrackArticulation } from './TrackArticulation'

/** niveles del PSG por frame (misma fórmula que el driver) para dibujar la envolvente */
function psgShape(i: Pick<PsgInst, 'vol' | 'a' | 'd' | 's' | 'r'>): number[] {
  const hold = 18
  const lv: number[] = []
  const peak = i.vol
  const sus = Math.max(0, peak - i.s)
  const n = i.a + i.d + hold
  let last = 0
  for (let age = 0; age < n; age++) {
    let l: number
    if (age < i.a) l = (peak * (age + 1)) / (i.a + 1)
    else if (i.d > 0 && age - i.a < i.d) l = peak - ((peak - sus) * (age - i.a)) / i.d
    else l = sus
    last = l
    lv.push(Math.round(l))
  }
  for (let k = 0; k < Math.max(1, i.r); k++) {
    const l = i.r <= 0 ? 0 : last * (1 - (k + 1) / i.r)
    lv.push(Math.max(0, Math.round(l)))
  }
  return lv
}

function EnvGraph({ i, color }: { i: Pick<PsgInst, 'vol' | 'a' | 'd' | 's' | 'r'>; color: string }) {
  const lv = psgShape(i)
  const W = 180
  const H = 56
  const sx = (W - 6) / Math.max(1, lv.length - 1)
  const pts = lv.map((l, k) => `${3 + k * sx},${H - 3 - (l / 15) * (H - 8)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="envbox tall" aria-hidden>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H - 3 - f * (H - 8)} y2={H - 3 - f * (H - 8)} stroke="rgba(0,244,142,0.1)" vectorEffect="non-scaling-stroke" />
      ))}
      <polygon points={`${pts} ${W - 3},${H - 3} 3,${H - 3}`} fill={color} opacity="0.14" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function PsgEditor() {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  const edit = useApp((s) => s.edit)
  const notify = useApp((s) => s.notify)
  const track = song.tracks[selTrack]
  const idx = track.kind === 'psg' ? track.inst : 0
  const inst = song.psgBank[idx]
  const set = (fn: (p: PsgInst) => void, key?: string) =>
    edit((d) => {
      const p = d.psgBank[idx]
      if (p) fn(p)
    }, key ?? `psg-${idx}`)
  const audition = () => void engine.preview(selTrack, 72, 14)
  const color = 'var(--c-psg)'

  return (
    <div className="insp-grid">
      <Section
        title="INSTRUMENTO PSG"
        right={
          <button className="btn sm primary" onClick={audition} title="Toca una nota con este sonido">
            {Icon.play} PROBAR
          </button>
        }
      >
        <div className="row">
          <select className="field grow" value={idx} onChange={(e) => edit((d) => (d.tracks[selTrack].inst = Number(e.target.value)))} aria-label="Instrumento de la pista">
            {song.psgBank.map((p, i) => (
              <option key={i} value={i}>
                {String(i + 1).padStart(2, '0')} {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn icon"
            title="Copiar este instrumento a un hueco nuevo del banco"
            aria-label="Duplicar instrumento"
            onClick={() =>
              edit((d) => {
                if (d.psgBank.length >= 32) return
                d.psgBank.push({ ...JSON.parse(JSON.stringify(d.psgBank[idx])), name: (d.psgBank[idx].name + ' 2').slice(0, 12) })
                d.tracks[selTrack].inst = d.psgBank.length - 1
              })
            }
          >
            {Icon.copy}
          </button>
        </div>
        <div className="row">
          <span className="label">NOMBRE</span>
          <TextField className="grow" value={inst.name} max={12} onChange={(v) => set((p) => (p.name = v.toUpperCase()))} label="Nombre del instrumento" />
        </div>
        <div className="row">
          <span className="label">FÁBRICA</span>
          <select
            className="field sm grow"
            value=""
            aria-label="Cargar un preset de fábrica"
            onChange={(e) => {
              const i = Number(e.target.value)
              if (e.target.value === '' || Number.isNaN(i)) return
              set((p) => Object.assign(p, JSON.parse(JSON.stringify(PSG_PRESETS[i]))), `psg-load-${idx}`)
              notify(`Preset ${PSG_PRESETS[i].name} cargado`)
            }}
          >
            <option value="">cargar preset…</option>
            {PSG_PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="ENVOLVENTE" right={<span className="label">60 Hz · 2 dB/paso</span>}>
        <EnvGraph i={inst} color="#4ad8ff" />
        <Slider label="VOL" title="Nivel de pico" value={inst.vol} min={1} max={15} def={13} color={color} onChange={(v) => set((p) => (p.vol = v), `psg-${idx}-vol`)} />
        <Slider label="ATK" title="Ataque, en frames" value={inst.a} min={0} max={40} def={0} color={color} format={(v) => `${v}f`} onChange={(v) => set((p) => (p.a = v), `psg-${idx}-a`)} />
        <Slider label="DEC" title="Decaimiento, en frames" value={inst.d} min={0} max={60} def={0} color={color} format={(v) => `${v}f`} onChange={(v) => set((p) => (p.d = v), `psg-${idx}-d`)} />
        <Slider label="SUS↓" title="Cuánto baja el sustain respecto al pico" value={inst.s} min={0} max={15} def={0} color={color} onChange={(v) => set((p) => (p.s = v), `psg-${idx}-s`)} />
        <Slider label="REL" title="Liberación, en frames" value={inst.r} min={0} max={60} def={3} color={color} format={(v) => `${v}f`} onChange={(v) => set((p) => (p.r = v), `psg-${idx}-r`)} />
      </Section>

      <Section title="TONO Y VIBRATO">
        <Slider
          label="VIB"
          title="Profundidad del vibrato, en cents"
          value={inst.vib?.depth ?? 0}
          min={0}
          max={100}
          def={0}
          color={color}
          format={(v) => `${v}c`}
          onChange={(v) => set((p) => (p.vib = v === 0 ? undefined : { delay: p.vib?.delay ?? 10, rate: p.vib?.rate ?? 5.5, depth: v }), `psg-${idx}-vib`)}
        />
        <Slider label="V.RATE" title="Velocidad del vibrato" value={inst.vib?.rate ?? 5.5} min={1} max={12} step={0.5} def={5.5} color={color} format={(v) => `${v}Hz`} onChange={(v) => set((p) => p.vib && (p.vib.rate = v), `psg-${idx}-vr`)} />
        <Slider label="V.DLY" title="Retardo antes de que empiece el vibrato, en frames" value={inst.vib?.delay ?? 10} min={0} max={60} def={10} color={color} format={(v) => `${v}f`} onChange={(v) => set((p) => p.vib && (p.vib.delay = v), `psg-${idx}-vd`)} />
        <Slider label="DETUNE" title="Desafinación fija, en cents" value={inst.detune} min={-50} max={50} def={0} color={color} format={(v) => `${v}c`} onChange={(v) => set((p) => (p.detune = v), `psg-${idx}-det`)} />
        <Slider
          label="PITCH↓"
          title="Caída de tono al atacar, en semitonos"
          value={inst.pitchEnv?.semis ?? 0}
          min={0}
          max={24}
          def={0}
          color={color}
          format={(v) => `+${v}`}
          onChange={(v) => set((p) => (p.pitchEnv = v === 0 ? undefined : { semis: v, frames: p.pitchEnv?.frames ?? 4 }), `psg-${idx}-pe`)}
        />
      </Section>

      <TrackArticulation color={color} />
    </div>
  )
}

export function NoiseEditor() {
  const song = useApp((s) => s.song)
  const edit = useApp((s) => s.edit)
  const ti = song.tracks.findIndex((t) => t.kind === 'noise')
  const color = 'var(--c-noise)'
  return (
    <div className="flex flex-col gap-2">
      <p className="hint">El canal de ruido del SN76489 tiene 6 sonidos: en el piano roll cada fila es uno de ellos.</p>
      <div className="kit-grid">
        {song.noiseKit.map((v, i) => (
          <div key={i} className="sec kit-card" style={{ '--kc': color } as CSSProperties}>
            <div className="kit-h">
              <span className="kit-n">{i + 1}</span>
              <TextField className="sm grow" value={v.name} max={10} onChange={(n) => edit((d) => (d.noiseKit[i].name = n.toUpperCase()))} label={`Nombre del sonido ${i + 1}`} />
              <button className="btn sm icon" disabled={ti < 0} onClick={() => void engine.preview(ti, i, 14)} title="Probar" aria-label={`Probar ${v.name}`}>
                {Icon.play}
              </button>
            </div>
            <div className="row">
              <Segmented
                value={v.white ? 1 : 0}
                options={[
                  { value: 1, label: 'BLANCO', title: 'Ruido blanco' },
                  { value: 0, label: 'PERIÓD.', title: 'Ruido periódico (zumbido afinado)' },
                ]}
                onChange={(w) => edit((d) => (d.noiseKit[i].white = w === 1))}
                label="Tipo de ruido"
              />
              <Segmented
                value={v.rate}
                options={[
                  { value: 0, label: 'AGUDO' },
                  { value: 1, label: 'MEDIO' },
                  { value: 2, label: 'GRAVE' },
                  { value: 3, label: 'SQ3', title: 'Sigue el tono del canal SQ3' },
                ]}
                onChange={(r) => edit((d) => (d.noiseKit[i].rate = r))}
                label="Tono del ruido"
              />
            </div>
            <Slider label="VOL" value={v.vol} min={1} max={15} color={color} onChange={(x) => edit((d) => (d.noiseKit[i].vol = x), `nz-${i}-v`)} />
            <Slider label="DEC" value={v.d} min={0} max={60} color={color} format={(x) => `${x}f`} onChange={(x) => edit((d) => (d.noiseKit[i].d = x), `nz-${i}-d`)} />
            <Slider label="SUS↓" value={v.s} min={0} max={15} color={color} onChange={(x) => edit((d) => (d.noiseKit[i].s = x), `nz-${i}-s`)} />
            <Slider label="REL" value={v.r} min={0} max={30} color={color} format={(x) => `${x}f`} onChange={(x) => edit((d) => (d.noiseKit[i].r = x), `nz-${i}-r`)} />
          </div>
        ))}
      </div>
    </div>
  )
}

const KINDS: { value: DrumKind; label: string }[] = [
  { value: 'kick', label: 'BOMBO' },
  { value: 'snare', label: 'CAJA' },
  { value: 'hat', label: 'HAT' },
  { value: 'ohat', label: 'HAT ABIERTO' },
  { value: 'clap', label: 'PALMAS' },
  { value: 'tom', label: 'TOM' },
  { value: 'rim', label: 'RIM' },
  { value: 'cow', label: 'COWBELL' },
  { value: 'zap', label: 'LÁSER' },
  { value: 'timp', label: 'TIMBAL' },
  { value: 'crash', label: 'PLATO' },
]

export function DrumEditor() {
  const song = useApp((s) => s.song)
  const edit = useApp((s) => s.edit)
  const ti = song.tracks.findIndex((t) => t.kind === 'dac')
  const color = 'var(--c-dac)'
  const pct = (x: number) => `${Math.round(x * 100)}`
  // el timbal se afina por semitonos (Do2–Do4): el mando enseña la nota
  const timpNote = (x: number) => noteName(Math.round(36 + x * 24))
  return (
    <div className="flex flex-col gap-2">
      <div className="row">
        <span className="label" title="El DAC del YM2612 (canal 6) reproduce muestras de 8 bits">
          TASA DEL DAC
        </span>
        <Segmented
          value={song.dacRate}
          options={[
            { value: 11025, label: '11 kHz', title: 'Granulado, muy Mega Drive' },
            { value: 14700, label: '14.7 kHz', title: 'Como los drivers de Z80 (XGM)' },
            { value: 22050, label: '22 kHz', title: 'Más limpio' },
          ]}
          onChange={(v) => edit((d) => (d.dacRate = v))}
          label="Tasa de muestreo del DAC"
        />
      </div>
      {ti < 0 && (
        <p className="hint" style={{ color: 'var(--warn)' }}>
          El canal 6 está en modo FM: activa la batería PCM con ⇄ en la pista 6.
        </p>
      )}
      <div className="kit-grid">
        {song.drumKit.map((v, i) => (
          <div key={i} className="sec kit-card" style={{ '--kc': color } as CSSProperties}>
            <div className="kit-h">
              <span className="kit-n">{i + 1}</span>
              <TextField className="sm grow" value={v.name} max={10} onChange={(n) => edit((d) => (d.drumKit[i].name = n.toUpperCase()))} label={`Nombre del sonido ${i + 1}`} />
              {v.kind === 'sample' ? (
                <span className="label" title="Muestra real de 8 bits: no se sintetiza, se reproduce tal cual">
                  MUESTRA {Math.round((((v.pcm?.length ?? 0) * 0.75) / (v.rate ?? 11025)) * 1000)} ms
                </span>
              ) : (
                <select className="field sm" value={v.kind} onChange={(e) => edit((d) => (d.drumKit[i].kind = e.target.value as DrumKind))} aria-label={`Tipo del sonido ${i + 1}`}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn sm icon" disabled={ti < 0} onClick={() => void engine.preview(ti, i, 14)} title="Probar" aria-label={`Probar ${v.name}`}>
                {Icon.play}
              </button>
            </div>
            <div className="kit-knobs">
              {v.kind !== 'sample' && <Knob label={v.kind === 'timp' ? 'NOTA' : 'TONO'} size={38} value={v.pitch} def={0.5} step={v.kind === 'timp' ? 1 / 24 : undefined} color={color} format={v.kind === 'timp' ? timpNote : pct} onChange={(x) => edit((d) => (d.drumKit[i].pitch = x), `dk-${i}-p`)} />}
              {v.kind !== 'sample' && <Knob label="LARGO" size={38} value={v.decay} def={0.5} color={color} format={pct} onChange={(x) => edit((d) => (d.drumKit[i].decay = x), `dk-${i}-d`)} />}
              {v.kind !== 'sample' && <Knob label="BRILLO" size={38} value={v.tone} def={0.5} color={color} format={pct} onChange={(x) => edit((d) => (d.drumKit[i].tone = x), `dk-${i}-t`)} />}
              <Knob label="NIVEL" size={38} value={v.gain} def={0.9} color={color} format={pct} onChange={(x) => edit((d) => (d.drumKit[i].gain = x), `dk-${i}-g`)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
