// ── Teclado virtual (piano / pads de batería) para tocar en directo ──────────
import { useRef, type CSSProperties } from 'react'
import { liveOff, liveOn } from '../state/controller'
import { useApp } from '../state/store'
import { isBlackKey, noteName } from '../music/theory'
import { Icon } from './icons'
import { KEYMAP, PAD_KEYS } from './keymap'
import { KIND_COLOR, KIND_TAG, cx, capturePointer } from './util'

/** `octaves` = octavas completas visibles (se añade el Do final) */
export function Keyboard({ octaves = 3 }: { octaves?: number }) {
  const song = useApp((s) => s.song)
  const selTrack = useApp((s) => s.selTrack)
  const octave = useApp((s) => s.octave)
  const held = useApp((s) => s.heldNotes)
  const set = useApp((s) => s.set)
  const noteVel = useApp((s) => s.noteVel)
  const track = song.tracks[selTrack]
  const down = useRef(new Set<number>())
  const isDrum = track.kind === 'dac' || track.kind === 'noise'
  const tc = { '--tc': KIND_COLOR[track.kind] } as CSSProperties
  const tag = `${KIND_TAG[track.kind]}${track.kind === 'noise' ? '' : track.ch + 1}`

  const on = (n: number) => {
    if (down.current.has(n)) return
    down.current.add(n)
    liveOn(n, noteVel)
  }
  const off = (n: number) => {
    if (!down.current.has(n)) return
    down.current.delete(n)
    liveOff(n)
  }

  const side = (
    <div className="kbd-side" style={tc}>
      <div className="kbd-who">
        <span className="trk-tag">{tag}</span>
        <b>{track.name}</b>
        <span className="label">{isDrum ? 'PADS' : 'TECLADO'}</span>
      </div>
      {isDrum ? (
        <p className="hint">
          Teclas <b>A S D F G H J K</b>
        </p>
      ) : (
        <div className="kbd-oct">
          <button className="btn sm icon" onClick={() => set({ octave: Math.max(1, octave - 1) })} title="Octava abajo (Z)" aria-label="Octava abajo" disabled={octave <= 1}>
            {Icon.left}
          </button>
          <span className="num" title="Octava base del teclado">
            C{octave}
          </span>
          <button className="btn sm icon" onClick={() => set({ octave: Math.min(7, octave + 1) })} title="Octava arriba (X)" aria-label="Octava arriba" disabled={octave >= 7}>
            {Icon.right}
          </button>
          <span className="hint">
            octava con <b>Z</b> y <b>X</b>
          </span>
        </div>
      )}
    </div>
  )

  if (isDrum) {
    const names = track.kind === 'dac' ? song.drumKit.map((d) => d.name) : song.noiseKit.map((d) => d.name)
    return (
      <>
        {side}
        <div className="kbd-keys pads" style={tc}>
          {names.map((n, i) => (
            <button
              key={i}
              className={cx('pad', held.includes(i) && 'down')}
              onPointerDown={(e) => {
                e.preventDefault()
                on(i)
              }}
              onPointerUp={() => off(i)}
              onPointerLeave={() => off(i)}
              onPointerCancel={() => off(i)}
            >
              <b>{n}</b>
              <small>{PAD_KEYS[i]?.toUpperCase()}</small>
            </button>
          ))}
        </div>
      </>
    )
  }

  const base = 12 * (octave + 1)
  const keys: number[] = []
  for (let i = 0; i <= octaves * 12; i++) if (base + i <= 127) keys.push(base + i)
  const whites = keys.filter((k) => !isBlackKey(k))
  const keyLabel = new Map<number, string>()
  for (const [k, semis] of Object.entries(KEYMAP)) keyLabel.set(base + semis, k.toUpperCase())
  const wPct = 100 / whites.length
  const whitesBefore = (midi: number) => whites.filter((w) => w < midi).length

  return (
    <>
      {side}
      <div className="kbd-keys">
        <div className="kbd-bed">
          {whites.map((k) => (
            <div
              key={k}
              className={cx('pkey-w', held.includes(k) && 'down')}
              onPointerDown={(e) => {
                e.preventDefault()
                capturePointer(e)
                on(k)
              }}
              onPointerUp={() => off(k)}
              onPointerCancel={() => off(k)}
            >
              <span className="pkey-lbl">
                <small>{keyLabel.get(k) ?? ''}</small>
                {k % 12 === 0 && <b>{noteName(k)}</b>}
              </span>
            </div>
          ))}
          {keys
            .filter((k) => isBlackKey(k))
            .map((k) => (
              <div
                key={k}
                className={cx('pkey-b', held.includes(k) && 'down')}
                style={{ left: `${(whitesBefore(k) - 0.3) * wPct}%`, width: `${wPct * 0.6}%` }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  capturePointer(e)
                  on(k)
                }}
                onPointerUp={() => off(k)}
                onPointerCancel={() => off(k)}
              >
                <span className="pkey-lbl">
                  <small>{keyLabel.get(k) ?? ''}</small>
                </span>
              </div>
            ))}
        </div>
      </div>
    </>
  )
}
