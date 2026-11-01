// ── Arreglo: paleta de patrones + línea de tiempo de la canción ──────────────
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { engine } from '../engine/client'
import { playFrom, toggleLoopPattern } from '../state/controller'
import { addPattern, deletePattern, duplicatePattern, insertOrder, moveOrder, removeOrder, renamePattern, setPatternBars } from '../music/edit'
import { MAX_ORDER, MAX_PATTERNS, getPattern, patternSteps } from '../music/song'
import { useApp } from '../state/store'
import { Segmented } from './controls'
import { Icon } from './icons'
import { PATTERN_HEX, cx } from './util'

const fmtTime = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

export function Arrangement() {
  const song = useApp((s) => s.song)
  const selPattern = useApp((s) => s.selPattern)
  const selectPattern = useApp((s) => s.selectPattern)
  const edit = useApp((s) => s.edit)
  const playing = useApp((s) => s.playing)
  const loopPattern = useApp((s) => s.loopPattern)
  const notify = useApp((s) => s.notify)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [pickedSlot, setPickedSlot] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  const tlRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  const sel = song.patterns.find((p) => p.id === selPattern) ?? song.patterns[0]
  const colorOf = (id: string): string => PATTERN_HEX[Math.max(0, song.patterns.findIndex((p) => p.id === id)) % PATTERN_HEX.length]
  // hueco activo del orden: el que se pulsó si sigue siendo de este patrón; si no, su primera aparición
  const slot = pickedSlot !== null && song.order[pickedSlot] === sel.id ? pickedSlot : song.order.indexOf(sel.id)
  const inOrder = slot >= 0

  // cabezal de la línea de tiempo: lo mueve el motor sin re-renderizar
  useEffect(() => {
    const head = headRef.current
    if (!head) return
    if (!playing) {
      head.style.display = 'none'
      return
    }
    let lastIdx = -1
    return engine.onStatus((s) => {
      const tl = tlRef.current
      if (!tl) return
      const st = useApp.getState()
      const el = tl.querySelector<HTMLElement>(st.loopPattern ? '.tl-b.sel' : `.tl-b[data-i="${s.pos.order}"]`)
      if (!el) {
        head.style.display = 'none'
        return
      }
      const idx = Number(el.dataset.i)
      const pat = getPattern(st.song, st.song.order[idx])
      const total = pat ? patternSteps(st.song, pat) : 1
      const f = Math.max(0, Math.min(1, (s.pos.step + s.pos.frac) / total))
      head.style.display = 'block'
      head.style.left = `${el.offsetLeft + el.offsetWidth * f}px`
      if (idx !== lastIdx) {
        lastIdx = idx
        // mantiene a la vista el bloque que suena cuando el orden no cabe entero
        if (el.offsetLeft < tl.scrollLeft || el.offsetLeft + el.offsetWidth > tl.scrollLeft + tl.clientWidth) tl.scrollLeft = Math.max(0, el.offsetLeft - 8)
      }
    })
  }, [playing])

  // compás en el que empieza cada bloque del orden
  const starts: number[] = []
  let totalBars = 0
  for (const id of song.order) {
    starts.push(totalBars + 1)
    totalBars += song.patterns.find((p) => p.id === id)?.bars ?? 0
  }
  const seconds = (totalBars * song.beatsPerBar * 60) / song.bpm

  const full = () => notify('Máximo de patrones alcanzado')

  const addNew = () => {
    if (song.patterns.length >= MAX_PATTERNS) return full()
    let id = ''
    edit((d) => {
      id = addPattern(d, sel.bars)
      insertOrder(d, id, inOrder ? slot + 1 : undefined)
    })
    if (id) {
      selectPattern(id)
      setPickedSlot(inOrder ? slot + 1 : null)
    }
  }

  const duplicate = () => {
    if (song.patterns.length >= MAX_PATTERNS) return full()
    let id = ''
    edit((d) => {
      id = duplicatePattern(d, sel.id)
      insertOrder(d, id, inOrder ? slot + 1 : undefined)
    })
    if (id) {
      selectPattern(id)
      setPickedSlot(inOrder ? slot + 1 : null)
    }
  }

  const remove = () => {
    const next = song.patterns.find((p) => p.id !== sel.id)
    edit((d) => deletePattern(d, sel.id))
    setPickedSlot(null)
    if (next) selectPattern(next.id)
    notify(`Patrón ${sel.name} eliminado · Ctrl+Z para recuperarlo`)
  }

  const move = (dir: -1 | 1) => {
    const to = slot + dir
    if (!inOrder || to < 0 || to >= song.order.length) return
    edit((d) => {
      // el inicio del bucle acompaña al bloque que lo lleva
      const loopId = d.loopStart === slot ? to : d.loopStart === to ? slot : d.loopStart
      moveOrder(d, slot, to)
      d.loopStart = loopId
    })
    setPickedSlot(to)
  }

  return (
    <section className="arr" aria-label="Arreglo">
      {/* paleta de patrones */}
      <div className="arr-row">
        <span className="title-px">PATRONES</span>
        <div className="chips">
          {song.patterns.map((p) =>
            renaming === p.id ? (
              <input
                key={p.id}
                autoFocus
                className="field sm chip-rename"
                defaultValue={p.name}
                maxLength={8}
                aria-label="Nombre del patrón"
                onBlur={(e) => {
                  setRenaming(null)
                  const v = e.target.value.trim()
                  if (v && v !== p.name) edit((d) => renamePattern(d, p.id, v))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  else if (e.key === 'Escape') setRenaming(null)
                  e.stopPropagation()
                }}
              />
            ) : (
              <button
                key={p.id}
                className={cx('chip', p.id === sel.id && 'sel')}
                style={{ '--pc': colorOf(p.id) } as CSSProperties}
                onClick={() => selectPattern(p.id)}
                onDoubleClick={() => setRenaming(p.id)}
                title={`${p.name} · ${p.bars} compases · doble clic: renombrar · [ ] cambia de patrón`}
              >
                {p.name}
                <small>{p.bars}</small>
              </button>
            ),
          )}
          <button className="btn sm icon" onClick={addNew} title="Patrón nuevo vacío (se añade al orden)" aria-label="Patrón nuevo">
            {Icon.plus}
          </button>
          <button className="btn sm icon" onClick={duplicate} title={`Duplicar ${sel.name} (la copia se añade al orden)`} aria-label="Duplicar patrón">
            {Icon.copy}
          </button>
          <button className="btn sm icon danger" onClick={remove} disabled={song.patterns.length <= 1} title={`Eliminar el patrón ${sel.name}`} aria-label="Eliminar patrón">
            {Icon.trash}
          </button>
        </div>
        <div className="arr-end">
          <button
            className={cx('btn sm loop-pat-btn', loopPattern && 'on')}
            onClick={toggleLoopPattern}
            aria-pressed={loopPattern}
            title={loopPattern ? `Repitiendo solo el patrón ${sel.name} · pulsa para volver a reproducir todo el orden (C)` : `Repetir en bucle solo el patrón ${sel.name}, sin pasar al siguiente del orden (C)`}
          >
            {Icon.loop}
            <span className="lbl">{loopPattern ? `REPITIENDO ${sel.name}` : 'REPETIR PATRÓN'}</span>
          </button>
          <span className="label">COMPASES</span>
          <Segmented
            value={sel.bars}
            onChange={(b) => edit((d) => setPatternBars(d, sel.id, b, true))}
            options={[1, 2, 4, 8, 16].map((b) => ({ value: b, label: String(b), title: `${b} compases${b > sel.bars ? ' · repite el contenido' : b < sel.bars ? ' · recorta' : ''}` }))}
            label="Compases del patrón"
          />
        </div>
      </div>

      {/* línea de tiempo: el orden en que suenan los patrones */}
      <div className="arr-row">
        <span className="title-px">ORDEN</span>
        <div
          className={cx('tl', loopPattern && 'loop-pat')}
          ref={tlRef}
          role="list"
          aria-label="Orden de la canción"
          onWheel={(e) => {
            // si el orden no cabe, la rueda lo desplaza en horizontal
            const tl = e.currentTarget
            if (tl.scrollWidth > tl.clientWidth) tl.scrollLeft += e.deltaY || e.deltaX
          }}
        >
          {song.order.map((id, i) => {
            const p = song.patterns.find((x) => x.id === id)
            const isLoop = song.loopStart === i
            return (
              <div
                key={`${id}-${i}`}
                data-i={i}
                role="listitem"
                tabIndex={0}
                draggable
                className={cx('tl-b', i === slot && 'sel', id === sel.id && 'cur', song.loopStart >= 0 && i >= song.loopStart && 'in-loop')}
                style={{ '--pc': colorOf(id), flexGrow: p?.bars ?? 1 } as CSSProperties}
                onClick={() => {
                  setPickedSlot(i)
                  selectPattern(id)
                }}
                onDoubleClick={() => void playFrom(i, 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    setPickedSlot(i)
                    selectPattern(id)
                  }
                }}
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const from = dragFrom.current
                  dragFrom.current = null
                  if (from === null || from === i) return
                  edit((d) => moveOrder(d, from, i))
                  setPickedSlot(null)
                }}
                title={`${i + 1}. ${p?.name ?? '?'} · compás ${starts[i]} · doble clic: reproducir desde aquí · arrastra para reordenar`}
              >
                <small className="bar-no">{starts[i]}</small>
                <b>{p?.name ?? '?'}</b>
                {isLoop && <span className="loop-flag">↺</span>}
              </div>
            )
          })}
          <div className="tl-head" ref={headRef} />
        </div>
        <div className="arr-end">
          <button className="btn sm icon" disabled={!inOrder || slot <= 0} onClick={() => move(-1)} title="Mover el bloque seleccionado antes" aria-label="Mover antes">
            {Icon.left}
          </button>
          <button className="btn sm icon" disabled={!inOrder || slot >= song.order.length - 1} onClick={() => move(1)} title="Mover el bloque seleccionado después" aria-label="Mover después">
            {Icon.right}
          </button>
          <button
            className={cx('btn sm icon solo', inOrder && song.loopStart === slot && 'on')}
            disabled={!inOrder}
            onClick={() => edit((d) => (d.loopStart = d.loopStart === slot ? -1 : slot))}
            title={inOrder && song.loopStart === slot ? 'Bucle de la CANCIÓN: al terminar el orden vuelve a este bloque · pulsa para quitarlo' : 'Bucle de la CANCIÓN: al terminar el orden, volver a este bloque. Para repetir un solo patrón usa REPETIR PATRÓN (C)'}
            aria-label="Inicio del bucle de la canción"
          >
            ↺
          </button>
          <button
            className="btn sm icon"
            disabled={song.order.length >= MAX_ORDER}
            onClick={() => {
              edit((d) => insertOrder(d, sel.id, inOrder ? slot + 1 : undefined))
              setPickedSlot(inOrder ? slot + 1 : song.order.length)
            }}
            title={`Añadir otra vez ${sel.name} ${inOrder ? 'detrás del bloque seleccionado' : 'al final'}`}
            aria-label="Añadir el patrón al orden"
          >
            {Icon.plus}
          </button>
          <button
            className="btn sm icon danger"
            disabled={!inOrder || song.order.length <= 1}
            onClick={() => {
              edit((d) => removeOrder(d, slot))
              setPickedSlot(null)
            }}
            title="Quitar el bloque seleccionado del orden (el patrón no se borra)"
            aria-label="Quitar del orden"
          >
            {Icon.close}
          </button>
          <span className="arr-sum" title="Duración de una pasada completa">
            {totalBars} comp · {fmtTime(seconds)}
            {song.loopStart < 0 && <i> · sin bucle</i>}
            {loopPattern && <i> · repitiendo {sel.name}</i>}
          </span>
        </div>
      </div>
    </section>
  )
}
