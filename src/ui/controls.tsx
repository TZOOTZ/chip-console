// ── Controles base con estética de consola (tamaños en rem: escalan con la interfaz) ─
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { cx, capturePointer, rem } from './util'

// ── Knob con arco SVG: arrastre vertical, doble clic = valor por defecto ─────
interface KnobProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  def?: number
  /** diámetro en px de diseño (a escala 100 %) */
  size?: number
  color?: string
  format?: (v: number) => string
  onChange: (v: number) => void
  onCommit?: () => void
}

export function Knob({ label, value, min = 0, max = 1, step, def, size = 44, color = 'var(--accent)', format, onChange, onCommit }: KnobProps) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const range = max - min
  const norm = Math.max(0, Math.min(1, (value - min) / range))

  const quant = useCallback(
    (v: number) => {
      let x = Math.max(min, Math.min(max, v))
      if (step) x = Math.round((x - min) / step) * step + min
      return x
    },
    [min, max, step],
  )

  // geometría en un viewBox fijo de 48: el tamaño real lo da el CSS
  const V = 48
  const r = V / 2 - 4
  const c = V / 2
  const a0 = -225
  const a1 = a0 + norm * 270
  const pt = (deg: number, rad: number): [number, number] => {
    const t = (deg * Math.PI) / 180
    return [c + rad * Math.cos(t), c + rad * Math.sin(t)]
  }
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from, r)
    const [x1, y1] = pt(to, r)
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`
  }
  const [px, py] = pt(a1, r - 5)
  const shown = format ? format(value) : String(Math.round(value * 100) / 100)

  return (
    <div className="knob no-select" title={`${label}: ${shown} · arrastra arriba/abajo (Shift = fino) · doble clic restablece`}>
      <svg
        viewBox={`0 0 ${V} ${V}`}
        style={{ width: rem(size), height: rem(size) }}
        className="touch-none cursor-ns-resize"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          capturePointer(e)
          drag.current = { y: e.clientY, v: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const fine = e.shiftKey ? 0.25 : 1
          const dv = ((drag.current.y - e.clientY) / 150) * range * fine
          onChange(quant(drag.current.v + dv))
        }}
        onPointerUp={() => {
          if (drag.current) onCommit?.()
          drag.current = null
        }}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => {
          if (def !== undefined) {
            onChange(def)
            onCommit?.()
          }
        }}
        onKeyDown={(e) => {
          const s = step ?? range / 50
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault()
            e.stopPropagation()
            onChange(quant(value + s))
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault()
            e.stopPropagation()
            onChange(quant(value - s))
          }
        }}
      >
        <path d={arc(-225, 45)} stroke="rgba(0,244,142,0.15)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {norm > 0.003 && <path d={arc(a0, a1)} stroke={color} strokeWidth="3.5" fill="none" strokeLinecap="round" />}
        <circle cx={c} cy={c} r={r - 7} fill="#030a07" stroke="rgba(0,244,142,0.32)" />
        <line x1={c} y1={c} x2={px} y2={py} stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="label">{label}</span>
      <span className="num" style={{ color }}>
        {shown}
      </span>
    </div>
  )
}

// ── Slider horizontal etiquetado ────────────────────────────────────────────
interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  def?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  onCommit?: () => void
  color?: string
  title?: string
}

export function Slider({ label, value, min, max, step = 1, def, format, onChange, onCommit, color, title }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="sld" title={title}>
      <span className="label">{label}</span>
      <input
        type="range"
        className="rng"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${pct}%`, ...(color ? { '--rc': color } : {}) } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
        onDoubleClick={() => def !== undefined && onChange(def)}
      />
      <span className="num" style={color ? { color } : undefined}>
        {format ? format(value) : value}
      </span>
    </label>
  )
}

// ── Barra de valor compacta: arrastre horizontal, doble clic = defecto ───────
interface BarProps {
  value: number
  min: number
  max: number
  def?: number
  color?: string
  title?: string
  label?: string
  className?: string
  format?: (v: number) => string
  onChange: (v: number) => void
}

export function BarSlider({ value, min, max, def, color, title, label, className, format, onChange }: BarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const fromX = (clientX: number) => {
    const el = ref.current
    if (!el) return value
    const r = el.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)))
    return Math.round(min + f * (max - min))
  }
  const pct = ((value - min) / Math.max(1, max - min)) * 100
  return (
    <div
      ref={ref}
      className={cx('bar', className)}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      title={title}
      style={color ? ({ '--bc': color } as CSSProperties) : undefined}
      onPointerDown={(e) => {
        capturePointer(e)
        dragging.current = true
        onChange(fromX(e.clientX))
      }}
      onPointerMove={(e) => dragging.current && onChange(fromX(e.clientX))}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => def !== undefined && onChange(def)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          onChange(Math.min(max, value + 1))
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          onChange(Math.max(min, value - 1))
        }
      }}
    >
      <i style={{ width: `${pct}%` }} />
      <span>{format ? format(value) : value}</span>
    </div>
  )
}

// ── Grupo segmentado: una opción elegida entre varias ───────────────────────
interface SegProps<T extends string | number> {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  large?: boolean
  /** ocupa todo el ancho repartiendo las opciones a partes iguales */
  fill?: boolean
  disabled?: boolean
  label?: string
}

export function Segmented<T extends string | number>({ value, options, onChange, large, fill, disabled, label }: SegProps<T>) {
  return (
    <div className={cx('seg', large && 'lg', fill && 'fill')} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} title={o.title} disabled={disabled} className={cx(value === o.value && 'sel')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Campo de texto con confirmación al perder el foco ───────────────────────
interface TextProps {
  value: string
  onChange: (v: string) => void
  max?: number
  className?: string
  placeholder?: string
  title?: string
  /** sin el estilo de campo por defecto (lo pone `className`) */
  bare?: boolean
  label?: string
}

export function TextField({ value, onChange, max = 40, className, placeholder, title, bare, label }: TextProps) {
  // borrador local mientras se escribe; null = mostrar el valor externo
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className={cx(!bare && 'field', className)}
      value={draft ?? value}
      maxLength={max}
      placeholder={placeholder}
      title={title}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onChange(draft)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          const el = e.target as HTMLInputElement
          // tras el render (que restaura el valor) se suelta el foco sin confirmar
          requestAnimationFrame(() => el.blur())
        }
        e.stopPropagation()
      }}
    />
  )
}

// ── Campo numérico: se puede teclear libremente; fuera de rango se ajusta al confirmar ─
interface NumProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  /** ancho en px de diseño */
  width?: number
  className?: string
  title?: string
  label?: string
}

export function NumField({ value, min, max, onChange, width = 56, className, title, label }: NumProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)))
  return (
    <input
      type="number"
      className={className ?? 'field'}
      style={className ? undefined : { width: rem(width) }}
      value={draft ?? value}
      min={min}
      max={max}
      title={title}
      aria-label={label}
      onChange={(e) => {
        const s = e.target.value
        setDraft(s)
        const n = Number(s)
        // dentro de rango se aplica al vuelo (flechas del campo); el resto, al confirmar
        if (s.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n))
      }}
      onBlur={() => {
        if (draft !== null && draft.trim() !== '') {
          const n = Number(draft)
          if (Number.isFinite(n) && clamp(n) !== value) onChange(clamp(n))
        }
        setDraft(null)
      }}
      onPointerDown={(e) => {
        if (e.altKey || e.shiftKey) {
          capturePointer(e)
          drag.current = { y: e.clientY, v: value }
          e.preventDefault()
        }
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(clamp(drag.current.v + (drag.current.y - e.clientY) / 3))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          const el = e.target as HTMLInputElement
          requestAnimationFrame(() => el.blur())
        }
        e.stopPropagation()
      }}
    />
  )
}

// ── Sección con título ──────────────────────────────────────────────────────
export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('sec', className)}>
      <div className="sec-h">
        <h3 className="title-px m-0">{title}</h3>
        {right}
      </div>
      <div className="sec-b">{children}</div>
    </section>
  )
}

// ── Menú emergente anclado a un botón ───────────────────────────────────────
export function Popover({ button, children, align = 'right' }: { button: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={ref} className="relative flex">
      {button(open, () => setOpen((o) => !o))}
      {open && (
        <div className="pop" style={{ [align]: 0 }} role="dialog">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Diálogo modal sobre <dialog> ────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} onClick={(e) => e.target === ref.current && onClose()} className="modal" style={{ width: `min(${rem(width)}, 94vw)` }}>
      <div className="pane-h modal-h">
        <h2 className="title-px m-0">{title}</h2>
        <button className="btn icon sm ghost" onClick={onClose} aria-label="Cerrar">
          {'✕'}
        </button>
      </div>
      <div className="modal-b">{open && children}</div>
    </dialog>
  )
}
