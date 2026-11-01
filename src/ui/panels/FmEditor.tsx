// ── Editor de parches FM de 4 operadores (YM2612) ───────────────────────────
import { useState } from 'react'
import { engine } from '../../engine/client'
import { FM_PRESETS } from '../../music/presets'
import { cleanFmPatch, type FmOp, type FmPatch } from '../../music/song'
import { Rng } from '../../music/generator'
import { useApp } from '../../state/store'
import { BarSlider, Knob, Section, Segmented, Slider, TextField } from '../controls'
import { cx } from '../util'
import { Icon } from '../icons'
import { TrackArticulation } from './TrackArticulation'

// posiciones de los operadores y conexiones por algoritmo (viewBox 120×50)
const ALG: { pos: [number, number][]; edges: [number, number][] }[] = [
  { pos: [[12, 25], [42, 25], [72, 25], [102, 25]], edges: [[0, 1], [1, 2], [2, 3]] },
  { pos: [[14, 12], [14, 38], [58, 25], [102, 25]], edges: [[0, 2], [1, 2], [2, 3]] },
  { pos: [[14, 12], [14, 38], [58, 38], [102, 25]], edges: [[0, 3], [1, 2], [2, 3]] },
  { pos: [[14, 12], [58, 12], [58, 38], [102, 25]], edges: [[0, 1], [1, 3], [2, 3]] },
  { pos: [[14, 12], [64, 12], [14, 38], [64, 38]], edges: [[0, 1], [2, 3]] },
  { pos: [[14, 25], [74, 8], [74, 25], [74, 42]], edges: [[0, 1], [0, 2], [0, 3]] },
  { pos: [[14, 12], [64, 12], [64, 27], [64, 42]], edges: [[0, 1]] },
  { pos: [[16, 25], [46, 25], [76, 25], [106, 25]], edges: [] },
]
const CARRIER: number[][] = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]]

const CAR_HEX = '#4ad8ff'
const MOD_HEX = '#00f48e'

function AlgDiagram({ alg, selOp, onSelOp, fb }: { alg: number; selOp?: number; onSelOp?: (op: number) => void; fb?: number }) {
  const d = ALG[alg]
  const car = CARRIER[alg]
  const W = 120
  const H = 50
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="alg" role="img" aria-label={`Algoritmo ${alg}: operadores ${car.map((o) => o + 1).join(', ')} portadores`}>
      <defs>
        <marker id="alg-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0 0L5 2.5L0 5z" fill="rgba(0,244,142,0.8)" />
        </marker>
      </defs>
      {d.edges.map(([a, b], i) => {
        const [x0, y0] = d.pos[a]
        const [x1, y1] = d.pos[b]
        return <line key={i} x1={x0 + 7} y1={y0} x2={x1 - 7} y2={y1} stroke="rgba(0,244,142,0.6)" strokeWidth="1.5" markerEnd="url(#alg-arrow)" />
      })}
      {car.map((o) => {
        const [x, y] = d.pos[o]
        return <line key={`o${o}`} x1={x + 7} y1={y} x2={W - 3} y2={y} stroke="rgba(74,216,255,0.55)" strokeWidth="1.2" strokeDasharray="2 2" />
      })}
      {fb !== undefined && fb > 0 && <path d={`M ${d.pos[0][0] - 3} ${d.pos[0][1] - 7} q -8 -9 0 -9 q 8 0 3 9`} fill="none" stroke="rgba(255,201,74,0.8)" strokeWidth="1.2" />}
      {d.pos.map(([x, y], i) => {
        const isCar = car.includes(i)
        const sel = selOp === i
        return (
          <g key={i} onClick={() => onSelOp?.(i)} style={{ cursor: onSelOp ? 'pointer' : 'default' }}>
            <rect x={x - 7} y={y - 7} width={14} height={14} rx="1.5" fill={sel ? (isCar ? CAR_HEX : MOD_HEX) : '#04100c'} stroke={isCar ? CAR_HEX : 'rgba(0,244,142,0.7)'} strokeWidth={isCar ? 1.8 : 1.2} />
            <text x={x} y={y + 3.4} textAnchor="middle" fontSize="9" fontFamily="'Space Mono', monospace" fontWeight="700" fill={sel ? '#00160c' : '#c9ffe9'}>
              {i + 1}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** perfil de envolvente (esquemático, tiempo logarítmico) */
function EnvShape({ op, color }: { op: FmOp; color: string }) {
  const W = 84
  const H = 28
  // tiempos relativos: tasas altas = más cortas
  const tA = 4 + (31 - op.ar) * 1.1
  const tD = op.d1r === 0 ? 0 : 4 + (31 - op.d1r) * 1.3
  const tS = 22
  const tR = 4 + (15 - op.rr) * 2.2
  const slLevel = 1 - op.sl / 15
  const total = tA + tD + tS + tR
  const sx = (W - 4) / Math.max(total, 1)
  const y = (lvl: number) => H - 3 - lvl * (H - 7)
  let x = 2
  const pts: [number, number][] = [[x, y(0)]]
  x += tA * sx
  pts.push([x, y(1)])
  x += tD * sx
  pts.push([x, y(op.d1r === 0 ? 1 : slLevel)])
  x += tS * sx
  const susEnd = op.d2r === 0 ? (op.d1r === 0 ? 1 : slLevel) : Math.max(0, (op.d1r === 0 ? 1 : slLevel) - 0.18 - op.d2r / 60)
  pts.push([x, y(susEnd)])
  x += tR * sx
  pts.push([x, y(0)])
  const line = pts.map((p) => p.join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="envbox" aria-hidden>
      <polygon points={`${line} ${W - 2},${H - 3} 2,${H - 3}`} fill={color} opacity="0.14" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const OP_PARAMS: { key: keyof FmOp; label: string; min: number; max: number; tip: string }[] = [
  { key: 'mul', label: 'MUL', min: 0, max: 15, tip: 'Multiplicador de frecuencia (0 = ×½)' },
  { key: 'dt', label: 'DT', min: 0, max: 7, tip: 'Desafinación fina (0-3 sube, 4-7 baja)' },
  { key: 'tl', label: 'TL', min: 0, max: 127, tip: 'Nivel total (0 = más fuerte, 0.75 dB/paso). En moduladores = profundidad FM' },
  { key: 'rs', label: 'RS', min: 0, max: 3, tip: 'Escalado de envolvente con la nota' },
  { key: 'ar', label: 'AR', min: 0, max: 31, tip: 'Ataque (31 = instantáneo)' },
  { key: 'd1r', label: 'D1R', min: 0, max: 31, tip: 'Decaimiento 1 (hasta SL)' },
  { key: 'sl', label: 'SL', min: 0, max: 15, tip: 'Nivel de sustain (15 = silencio)' },
  { key: 'd2r', label: 'D2R', min: 0, max: 31, tip: 'Decaimiento 2 (durante el sustain)' },
  { key: 'rr', label: 'RR', min: 0, max: 15, tip: 'Liberación' },
  { key: 'am', label: 'AM', min: 0, max: 1, tip: 'Sensible al LFO de amplitud' },
]

const LFO_RATES = ['OFF', '3.9 Hz', '5.6 Hz', '6.0 Hz', '6.4 Hz', '6.9 Hz', '9.6 Hz', '48 Hz', '72 Hz']

function randomPatch(rng: Rng, name: string): FmPatch {
  const alg = rng.int(0, 7)
  const car = CARRIER[alg]
  const muls = [0, 1, 1, 1, 2, 2, 3, 4, 5, 7]
  const ops: FmOp[] = [0, 1, 2, 3].map((i) => {
    const isCar = car.includes(i)
    const fast = rng.chance(0.4)
    return {
      mul: isCar ? rng.pick([1, 1, 1, 2, 0]) : rng.pick(muls),
      dt: rng.chance(0.35) ? rng.int(1, 7) : 0,
      tl: isCar ? rng.int(2, 14) : rng.int(18, 48),
      rs: rng.int(0, 1),
      ar: rng.chance(0.75) ? 31 : rng.int(14, 28),
      d1r: fast ? rng.int(10, 24) : rng.int(0, 10),
      sl: fast ? rng.int(6, 15) : rng.int(0, 7),
      d2r: rng.chance(0.3) ? rng.int(2, 8) : 0,
      rr: rng.int(5, 12),
      am: 0,
    }
  })
  return { name, alg, fb: rng.int(0, 6), ops, ams: 0, pms: 0 }
}

export function FmEditor() {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  const edit = useApp((s) => s.edit)
  const notify = useApp((s) => s.notify)
  const track = song.tracks[selTrack]
  const slot = track.kind === 'fm' ? track.inst : 0
  const patch = song.fmBank[slot]
  const [op, setOp] = useState(0)
  const [seed, setSeed] = useState(1)
  const patchIdx = slot
  const carriers = CARRIER[patch.alg]

  const setP = (fn: (p: FmPatch) => void, key?: string) =>
    edit((d) => {
      const p = d.fmBank[patchIdx]
      if (p) fn(p)
    }, key ?? `fm-${patchIdx}`)

  const audition = () => void engine.preview(selTrack, 60, 13)

  return (
    <div className="insp-grid">
      <Section
        title="PARCHE FM"
        right={
          <button className="btn sm primary" onClick={audition} title="Toca un Do central con este sonido">
            {Icon.play} PROBAR
          </button>
        }
      >
        <div className="row">
          <select className="field grow" value={patchIdx} onChange={(e) => edit((d) => (d.tracks[selTrack].inst = Number(e.target.value)))} aria-label="Parche de la pista" title="Parche que usa esta pista">
            {song.fmBank.map((p, i) => (
              <option key={i} value={i}>
                {String(i + 1).padStart(2, '0')} {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn icon"
            title="Copiar este parche a un hueco nuevo del banco"
            aria-label="Duplicar parche"
            onClick={() => {
              edit((d) => {
                if (d.fmBank.length >= 64) return
                d.fmBank.push({ ...JSON.parse(JSON.stringify(d.fmBank[patchIdx])), name: (d.fmBank[patchIdx].name + ' 2').slice(0, 14) })
                d.tracks[selTrack].inst = d.fmBank.length - 1
              })
            }}
          >
            {Icon.copy}
          </button>
        </div>
        <div className="row">
          <span className="label">NOMBRE</span>
          <TextField className="grow" value={patch.name} max={14} onChange={(v) => setP((p) => (p.name = v.toUpperCase()))} label="Nombre del parche" />
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
              const src = FM_PRESETS[i]
              setP((p) => Object.assign(p, JSON.parse(JSON.stringify(src))), `fm-load-${patchIdx}`)
              notify(`Preset ${src.name} cargado en el hueco ${patchIdx + 1}`)
            }}
          >
            <option value="">cargar preset…</option>
            {FM_PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid2">
          <button
            className="btn"
            title="Parche aleatorio (sustituye al actual; Ctrl+Z lo recupera)"
            onClick={() => {
              const rng = new Rng(seed * 7919 + Date.now())
              setSeed((s) => s + 1)
              const rp = randomPatch(rng, 'RANDOM')
              setP((p) => Object.assign(p, cleanFmPatch(rp)), `fm-rand-${patchIdx}`)
              setTimeout(audition, 30)
            }}
          >
            {Icon.dice} ALEATORIO
          </button>
          <button
            className="btn"
            title="Variación pequeña del parche actual"
            onClick={() => {
              const rng = new Rng(Date.now() & 0xffffff)
              setP((p) => {
                p.fb = Math.max(0, Math.min(7, p.fb + rng.int(-1, 1)))
                for (const o of p.ops) {
                  o.tl = Math.max(0, Math.min(127, o.tl + rng.int(-4, 4)))
                  if (rng.chance(0.25)) o.mul = Math.max(0, Math.min(15, o.mul + rng.pick([-1, 1])))
                  if (rng.chance(0.2)) o.d1r = Math.max(0, Math.min(31, o.d1r + rng.int(-3, 3)))
                }
              }, `fm-mut-${patchIdx}`)
              setTimeout(audition, 30)
            }}
          >
            MUTAR
          </button>
        </div>
      </Section>

      <Section title="ALGORITMO · FB · LFO">
        <Segmented value={patch.alg} onChange={(a) => setP((p) => (p.alg = a))} options={ALG.map((_, i) => ({ value: i, label: String(i), title: `Algoritmo ${i}` }))} fill label="Algoritmo" />
        <div className="fm-top">
          <div className="alg-box">
            <AlgDiagram alg={patch.alg} selOp={op} onSelOp={setOp} fb={patch.fb} />
          </div>
          <Knob label="FB" value={patch.fb} min={0} max={7} step={1} def={0} size={38} color="var(--warn)" format={(v) => String(v)} onChange={(v) => setP((p) => (p.fb = v), `fm-fb-${patchIdx}`)} />
          <Knob label="AMS" value={patch.ams} min={0} max={3} step={1} def={0} size={34} format={(v) => String(v)} onChange={(v) => setP((p) => (p.ams = v), `fm-ams-${patchIdx}`)} />
          <Knob label="PMS" value={patch.pms} min={0} max={7} step={1} def={0} size={34} format={(v) => String(v)} onChange={(v) => setP((p) => (p.pms = v), `fm-pms-${patchIdx}`)} />
        </div>
        <p className="hint">
          <b style={{ color: CAR_HEX }}>Azul</b> = portador (se oye) · <b>verde</b> = modulador (da el timbre) · FB realimenta el OP1.
        </p>
        <div className="row">
          <span className="label" title="LFO hardware compartido por los 6 canales FM: AMS y PMS de cada parche deciden cuánto le afecta">
            LFO GLOBAL
          </span>
          <select className="field sm grow" value={song.lfo} onChange={(e) => edit((d) => (d.lfo = Number(e.target.value)))} title="Frecuencia del LFO del YM2612 (común a toda la canción)" aria-label="Frecuencia del LFO global">
            {LFO_RATES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <Slider
          label="VIB"
          title="Vibrato por software, en cents"
          value={patch.vib?.depth ?? 0}
          min={0}
          max={100}
          def={0}
          format={(v) => `${v}c`}
          onChange={(v) => setP((p) => (p.vib = v === 0 ? undefined : { delay: p.vib?.delay ?? 14, rate: p.vib?.rate ?? 5.5, depth: v }), `fm-vib-${patchIdx}`)}
        />
        <Slider
          label="PITCH"
          title="Caída de tono al atacar, en semitonos (bombos, toms, láseres)"
          value={patch.pitchEnv?.semis ?? 0}
          min={0}
          max={36}
          def={0}
          format={(v) => `+${v}`}
          onChange={(v) => setP((p) => (p.pitchEnv = v === 0 ? undefined : { semis: v, frames: p.pitchEnv?.frames ?? 6 }), `fm-pe-${patchIdx}`)}
        />
        <Slider
          label="VEL→T"
          title="Velocidad → timbre: dB que se cierran los moduladores en las notas suaves y se abren en las fuertes (0 = la velocidad solo cambia el volumen)"
          value={patch.velMod ?? 0}
          min={0}
          max={24}
          def={0}
          format={(v) => (v === 0 ? 'OFF' : `${v} dB`)}
          onChange={(v) =>
            setP((p) => {
              if (v === 0) delete p.velMod
              else p.velMod = v
            }, `fm-vm-${patchIdx}`)
          }
        />
      </Section>

      <TrackArticulation />

      <Section title="OPERADORES">
        <div className="fm-grid">
          <span />
          {[0, 1, 2, 3].map((i) => {
            const isCar = carriers.includes(i)
            return (
              <button key={i} className={cx('fm-op', isCar && 'car', op === i && 'on')} onClick={() => setOp(i)} title={isCar ? `Operador ${i + 1}: portador (se oye)` : `Operador ${i + 1}: modulador`}>
                OP{i + 1}
              </button>
            )
          })}
          <span />
          {[0, 1, 2, 3].map((i) => (
            <EnvShape key={i} op={patch.ops[i]} color={carriers.includes(i) ? CAR_HEX : MOD_HEX} />
          ))}
          {OP_PARAMS.map((pm) => (
            <FmRow key={pm.key} pm={pm} patch={patch} carriers={carriers} onChange={(i, v) => setP((p) => ((p.ops[i][pm.key] as number) = v), `fm-${patchIdx}-${i}-${pm.key}`)} />
          ))}
        </div>
      </Section>
    </div>
  )
}

function FmRow({ pm, patch, carriers, onChange }: { pm: (typeof OP_PARAMS)[number]; patch: FmPatch; carriers: number[]; onChange: (op: number, v: number) => void }) {
  return (
    <>
      <span className="fm-lbl" title={pm.tip}>
        {pm.label}
      </span>
      {[0, 1, 2, 3].map((i) => (
        <BarSlider
          key={i}
          value={patch.ops[i][pm.key] as number}
          min={pm.min}
          max={pm.max}
          color={carriers.includes(i) ? 'rgba(74,216,255,0.4)' : 'rgba(0,244,142,0.38)'}
          title={`OP${i + 1} · ${pm.tip}`}
          label={`${pm.label} del operador ${i + 1}`}
          onChange={(v) => onChange(i, v)}
        />
      ))}
    </>
  )
}
