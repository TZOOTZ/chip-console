// ── Piano roll / secuenciador de pasos en canvas ─────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyEvent, type PointerEvent as RPointerEvent } from 'react'
import { engine } from '../engine/client'
import { playFrom } from '../state/controller'
import { addNote, quantizeNotes, setTrackNotes } from '../music/edit'
import { getPattern, patternSteps, stepsPerBar, type Note, type Pan, type Track } from '../music/song'
import { inScale, isBlackKey, noteName, snapToScale } from '../music/theory'
import { selectPatternObj, selectTrackObj, useApp } from '../state/store'
import { BarSlider, Segmented } from './controls'
import { useMediaQuery } from './hooks'
import { Icon } from './icons'
import { PAD_KEYS } from './keymap'
import { KIND_COLOR, KIND_HEX, KIND_TAG, cx, capturePointer } from './util'

/** medidas de diseño (px a escala 100 %): se multiplican por la escala de la interfaz */
const D = { gutter: 64, ruler: 22, vel: 40, drumMin: 26, drumMax: 52, pad: 32 }
const ZOOM_MIN = 5
const ZOOM_MAX = 64
const ROW_MIN = 9
const ROW_MAX = 28

const WHITE_KEY = '#b7d9c9'
const WHITE_KEY_HOVER = '#e2fbef'
const BLACK_KEY = '#0b1713'
const BLACK_KEY_HOVER = '#1d3a2f'

const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 2) / 2))

type Drag =
  | { kind: 'move'; indices: number[]; ox: number; oy: number; dx: number; dy: number; copy: boolean }
  | { kind: 'resize'; indices: number[]; ox: number; dLen: number }
  | { kind: 'create'; step: number; note: number; len: number }
  | { kind: 'rubber'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'vel'; index: number; vel: number }

/** geometría real en px de pantalla */
interface Geo {
  /** escala de la interfaz */
  k: number
  gutter: number
  ruler: number
  vel: number
  /** px por paso */
  zx: number
}

interface Layout {
  lo: number
  hi: number
  rows: number
  /** alto de fila en px de pantalla */
  rowH: number
  drum: boolean
}

function layoutFor(track: Track, drumCount: number, rowH: number, k: number, areaH: number): Layout {
  if (track.kind === 'dac' || track.kind === 'noise') {
    // las filas de batería se estiran para aprovechar el alto disponible
    const min = Math.round(D.drumMin * k)
    const max = Math.round(D.drumMax * k)
    const fit = drumCount > 0 ? Math.floor(areaH / drumCount) : min
    return { lo: 0, hi: drumCount - 1, rows: drumCount, rowH: Math.max(min, Math.min(max, fit)), drum: true }
  }
  const lo = track.kind === 'psg' ? 45 : 24
  const hi = 108
  return { lo, hi, rows: hi - lo + 1, rowH: Math.max(6, Math.round(rowH * k)), drum: false }
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number): void {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2))
  g.beginPath()
  if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, r)
  else g.rect(x, y, w, h)
}

const rowOfNote = (note: number, l: Layout): number => (l.drum ? note : l.hi - note)
const noteOfRow = (row: number, l: Layout): number => (l.drum ? row : l.hi - row)

/** el primer encaje de zoom (4 compases a la vista) se hace una sola vez por sesión */
let autoZoomDone = false

export function PianoRoll() {
  const song = useApp((s) => s.song)
  const track = useApp(selectTrackObj)
  const pattern = useApp(selectPatternObj)
  const selNotes = useApp((s) => s.selNotes)
  const zoom = useApp((s) => s.zoom)
  const rowHBase = useApp((s) => s.rowH)
  const noteLen = useApp((s) => s.noteLen)
  const noteVel = useApp((s) => s.noteVel)
  const grid = useApp((s) => s.grid)
  const scaleLock = useApp((s) => s.scaleLock)
  const playing = useApp((s) => s.playing)
  const followPlay = useApp((s) => s.followPlay)
  const loopPattern = useApp((s) => s.loopPattern)
  const scale = useApp((s) => s.scale)
  const held = useApp((s) => s.heldNotes)
  const edit = useApp((s) => s.edit)
  const set = useApp((s) => s.set)
  const setSelNotes = useApp((s) => s.setSelNotes)

  const [ghost, setGhost] = useState(true)
  const [viewH, setViewH] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const dirtyRef = useRef(true)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const hoverRef = useRef<{ x: number; y: number; onNote: boolean } | null>(null)
  /** punto que debe quedarse quieto tras un cambio de zoom */
  const anchorRef = useRef<{ step?: number; mx?: number; row?: number } | null>(null)

  const steps = patternSteps(song, pattern)
  const spb = stepsPerBar(song)
  const drumCount = track.kind === 'dac' ? song.drumKit.length : song.noiseKit.length
  const G: Geo = useMemo(() => ({ k: scale, gutter: Math.round(D.gutter * scale), ruler: Math.round(D.ruler * scale), vel: Math.round(D.vel * scale), zx: zoom * scale }), [scale, zoom])
  const L = useMemo(() => layoutFor(track, drumCount, rowHBase, scale, Math.max(0, viewH - G.ruler - G.vel)), [track, drumCount, rowHBase, scale, viewH, G])
  const notes: Note[] = pattern.notes[track.id] ?? []

  // últimos valores para los manejadores imperativos
  const ref = useRef({ song, track, pattern, notes, selNotes, zoom, G, L, steps, spb, noteLen, noteVel, grid, scaleLock, ghost, playing, followPlay, loopPattern, held })
  useLayoutEffect(() => {
    ref.current = { song, track, pattern, notes, selNotes, zoom, G, L, steps, spb, noteLen, noteVel, grid, scaleLock, ghost, playing, followPlay, loopPattern, held }
  })

  const invalidate = useCallback(() => {
    dirtyRef.current = true
  }, [])

  // ── geometría ──
  const contentW = G.gutter + steps * G.zx + Math.round(D.pad * scale)
  const contentH = G.ruler + L.rows * L.rowH + G.vel

  // ── dibujo ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const { w, h, dpr } = sizeRef.current
    if (w === 0 || h === 0) return
    const g = canvas.getContext('2d')
    if (!g) return
    const r = ref.current
    const { k, gutter, ruler, vel: velH, zx } = r.G
    const rowH = r.L.rowH
    const sx = wrap.scrollLeft
    const sy = wrap.scrollTop
    const areaTop = ruler
    const areaBottom = h - velH
    const areaH = areaBottom - areaTop
    const u = (n: number) => Math.max(1, Math.round(n * k))
    const drag = dragRef.current
    const hov = drag ? null : hoverRef.current
    const col = KIND_HEX[r.track.kind]
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.fillStyle = '#040a08'
    g.fillRect(0, 0, w, h)

    const firstRow = Math.max(0, Math.floor(sy / rowH))
    const lastRow = Math.min(r.L.rows - 1, Math.ceil((sy + areaH) / rowH))
    const total = r.steps * zx
    const hovRow = hov && hov.y > areaTop && hov.y < areaBottom ? Math.floor((hov.y - areaTop + sy) / rowH) : -1
    const hovInGrid = hov !== null && hov.x >= gutter && hovRow >= 0 && hovRow < r.L.rows
    const chroma = r.song.scale === 'chromatic'

    // ── filas ──
    g.save()
    g.beginPath()
    g.rect(gutter, areaTop, w - gutter, areaH)
    g.clip()
    for (let row = firstRow; row <= lastRow; row++) {
      const y = areaTop + row * rowH - sy
      const note = noteOfRow(row, r.L)
      let bg: string
      let octave = false
      if (r.L.drum) bg = row % 2 === 0 ? 'rgba(0,244,142,0.05)' : 'rgba(0,244,142,0.018)'
      else {
        const pc = (((note - r.song.key) % 12) + 12) % 12
        octave = ((note % 12) + 12) % 12 === 0
        if (pc === 0) bg = 'rgba(0,244,142,0.15)'
        else if (chroma) bg = isBlackKey(note) ? 'rgba(0,0,0,0.36)' : 'rgba(0,244,142,0.035)'
        else bg = inScale(note, r.song.key, r.song.scale) ? 'rgba(0,244,142,0.07)' : 'rgba(0,0,0,0.36)'
      }
      g.fillStyle = bg
      g.fillRect(gutter, y, w - gutter, rowH)
      if (row === hovRow) {
        g.fillStyle = 'rgba(255,255,255,0.05)'
        g.fillRect(gutter, y, w - gutter, rowH)
      }
      // separador de fila, más marcado entre octavas (bajo cada Do)
      g.fillStyle = octave ? 'rgba(0,244,142,0.22)' : 'rgba(0,244,142,0.06)'
      g.fillRect(gutter, y + rowH - 1, w - gutter, 1)
    }

    // ── columnas ──
    const s0 = Math.max(0, Math.floor(sx / zx))
    const s1 = Math.min(r.steps, Math.ceil((sx + w - gutter) / zx))
    for (let b = Math.floor(s0 / r.spb); b * r.spb < s1; b++) {
      if (b % 2 === 1) {
        g.fillStyle = 'rgba(0,0,0,0.17)'
        g.fillRect(gutter + b * r.spb * zx - sx, areaTop, r.spb * zx, areaH)
      }
    }
    const showSteps = zx >= 7 * k
    for (let s = s0; s <= s1; s++) {
      const bar = s % r.spb === 0
      const beat = s % 4 === 0
      if (!bar && !beat && !showSteps) continue
      g.fillStyle = bar ? 'rgba(0,244,142,0.5)' : beat ? 'rgba(0,244,142,0.2)' : 'rgba(0,244,142,0.065)'
      g.fillRect(Math.round(gutter + s * zx - sx), areaTop, 1, areaH)
    }

    // en batería las filas son altas: el golpe se dibuja como un bloque centrado
    const inset = r.L.drum ? Math.round(rowH * 0.2) : 0
    const rect = (n: Note, dx = 0, dy = 0, dLen = 0) => {
      const x = gutter + (n.step + dx) * zx - sx
      const y = areaTop + rowOfNote(n.note + dy, r.L) * rowH - sy
      const wd = Math.max(zx * 0.5, (n.len + dLen) * zx - 1)
      return { x, y: y + inset, w: wd, h: rowH - 1 - inset * 2 }
    }
    const visible = (q: { x: number; y: number; w: number; h: number }) => !(q.x + q.w < gutter || q.x > w || q.y + q.h < areaTop || q.y > areaBottom)

    // ── notas fantasma de las demás pistas (solo melódicas ↔ melódicas) ──
    if (r.ghost && !r.L.drum) {
      const thin = Math.max(1, Math.round(rowH * 0.22))
      for (const t of r.song.tracks) {
        if (t.id === r.track.id || t.kind === 'dac' || t.kind === 'noise') continue
        const gnotes = r.pattern.notes[t.id] ?? []
        if (gnotes.length === 0) continue
        g.fillStyle = KIND_HEX[t.kind]
        g.globalAlpha = 0.17
        for (const n of gnotes) {
          if (n.note < r.L.lo || n.note > r.L.hi) continue
          const q = rect(n)
          if (visible(q)) g.fillRect(q.x, q.y + thin, q.w, q.h - thin * 2)
        }
        g.globalAlpha = 1
      }
    }

    // ── notas ──
    const sel = new Set(r.selNotes)
    const rad = u(2)
    const fontPx = Math.max(8, Math.round(Math.min(10 * k, rowH - 3)))
    /** ancho de la rampa de entrada de una nota ligada */
    const rampOf = (q: { w: number; h: number }): number => Math.min(q.w * 0.7, q.h)
    const paint = (q: { x: number; y: number; w: number; h: number }, isSel: boolean, alpha: number, label: string | null, art?: Pick<Note, 'slide' | 'pan'>) => {
      if (!visible(q)) return
      g.globalAlpha = alpha
      g.fillStyle = col
      rrect(g, q.x, q.y, q.w, q.h, rad)
      g.fill()
      g.globalAlpha = 1
      // brillo superior y borde de ataque
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillRect(q.x + rad, q.y, Math.max(0, q.w - rad * 2), u(1))
      const ramp = art?.slide ? rampOf(q) : 0
      if (ramp) {
        // ligada: no vuelve a atacar, así que en vez de borde de ataque entra en rampa
        g.fillStyle = '#040a08'
        g.beginPath()
        g.moveTo(q.x - 1, q.y - 1)
        g.lineTo(q.x + ramp, q.y - 1)
        g.lineTo(q.x - 1, q.y + q.h + 1)
        g.closePath()
        g.fill()
      } else {
        g.fillStyle = 'rgba(0,0,0,0.28)'
        g.fillRect(q.x, q.y + rad, u(1.5), Math.max(0, q.h - rad * 2))
      }
      if (art?.pan) {
        // panorama propio: una pestaña blanca abajo, a la izquierda, en el centro o a la derecha
        const tw = Math.max(u(3), Math.min(q.w * 0.45, u(9)))
        const tx = art.pan === 'L' ? q.x + u(1) : art.pan === 'R' ? q.x + q.w - tw - u(1) : q.x + (q.w - tw) / 2
        g.fillStyle = '#ffffff'
        g.fillRect(tx, q.y + q.h - u(3), tw, u(2))
      }
      if (isSel) {
        g.strokeStyle = '#ffffff'
        g.lineWidth = Math.max(1.5, 1.5 * k)
        rrect(g, q.x + 0.75, q.y + 0.75, q.w - 1.5, q.h - 1.5, rad)
        g.stroke()
      }
      if (label && q.w - ramp > fontPx * 3.3 && rowH >= 11 * k) {
        g.fillStyle = 'rgba(0,14,8,0.9)'
        g.font = `700 ${fontPx}px "Space Mono", monospace`
        g.textBaseline = 'middle'
        g.fillText(label, q.x + ramp + u(4), q.y + q.h / 2 + 0.5)
      }
    }
    // ligaduras: un trazo une cada nota ligada con la que venía sonando
    if (!r.L.drum) {
      g.strokeStyle = '#ffffff'
      g.lineWidth = Math.max(1.5, 1.5 * k)
      g.globalAlpha = 0.85
      r.notes.forEach((n, i) => {
        if (!n.slide) return
        let from: Note | undefined
        for (let j = i - 1; j >= 0 && !from; j--) if (r.notes[j].step < n.step) from = r.notes[j]
        if (!from || from.step + from.len < n.step) return
        const a = rect(from)
        const b = rect(n)
        if (!visible(a) && !visible(b)) return
        g.beginPath()
        g.moveTo(a.x + a.w - u(1), a.y + a.h / 2)
        g.lineTo(b.x + rampOf(b) / 2, b.y + b.h / 2)
        g.stroke()
      })
      g.globalAlpha = 1
    }
    r.notes.forEach((n, i) => {
      const alpha = 0.42 + (n.vel / 15) * 0.58
      let dx = 0
      let dy = 0
      let dLen = 0
      if (drag?.kind === 'move' && drag.indices.includes(i)) {
        // al clonar (Ctrl) el original se queda en su sitio
        if (drag.copy) paint(rect(n), false, alpha, r.L.drum ? null : noteName(n.note), n)
        dx = drag.dx
        dy = drag.dy
      } else if (drag?.kind === 'resize' && drag.indices.includes(i)) dLen = drag.dLen
      paint(rect(n, dx, dy, dLen), sel.has(i), alpha, r.L.drum ? null : noteName(n.note + dy), n)
    })

    // nota(s) que se están creando
    if (drag?.kind === 'create') {
      const stride = r.L.drum ? Math.max(1, r.grid) : drag.len
      for (let s = drag.step; s < drag.step + drag.len; s += stride) {
        const q = rect({ step: s, len: r.L.drum ? 1 : drag.len, note: drag.note, vel: r.noteVel })
        g.globalAlpha = 0.8
        g.fillStyle = col
        rrect(g, q.x, q.y, q.w, q.h, rad)
        g.fill()
        g.globalAlpha = 1
        g.strokeStyle = '#ffffff'
        g.lineWidth = 1
        rrect(g, q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, rad)
        g.stroke()
      }
    }
    // silueta de la nota que crearía un clic aquí
    if (hov && hovInGrid && !hov.onNote) {
      const gs = Math.max(1, r.grid)
      const step = Math.floor((hov.x - gutter + sx) / zx / gs) * gs
      if (step >= 0 && step < r.steps) {
        let note = noteOfRow(hovRow, r.L)
        if (r.scaleLock && !r.L.drum) note = Math.max(r.L.lo, Math.min(r.L.hi, snapToScale(note, r.song.key, r.song.scale)))
        const q = rect({ step, len: r.L.drum ? 1 : Math.min(r.noteLen, r.steps - step), note, vel: r.noteVel })
        g.globalAlpha = 0.2
        g.fillStyle = col
        rrect(g, q.x, q.y, q.w, q.h, rad)
        g.fill()
        g.globalAlpha = 0.6
        g.strokeStyle = '#ffffff'
        g.lineWidth = 1
        rrect(g, q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, rad)
        g.stroke()
        g.globalAlpha = 1
      }
    }
    if (drag?.kind === 'rubber') {
      const x = Math.min(drag.x0, drag.x1)
      const y = Math.min(drag.y0, drag.y1)
      g.fillStyle = 'rgba(0,244,142,0.12)'
      g.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
      g.strokeStyle = 'rgba(255,255,255,0.8)'
      g.lineWidth = 1
      g.setLineDash([4, 3])
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
      g.setLineDash([])
    }

    // fin del patrón
    const endX = Math.round(gutter + total - sx)
    if (endX < w) {
      g.fillStyle = 'rgba(0,0,0,0.58)'
      g.fillRect(endX, areaTop, w - endX, areaH)
      g.fillStyle = 'rgba(0,244,142,0.55)'
      g.fillRect(endX, areaTop, u(2), areaH)
    }
    g.restore()

    // ── regla (compases y pulsos) ──
    g.fillStyle = '#07110e'
    g.fillRect(gutter, 0, w - gutter, ruler)
    g.save()
    g.beginPath()
    g.rect(gutter, 0, w - gutter, ruler)
    g.clip()
    if (hov && hov.x >= gutter) {
      const gs = Math.max(1, r.grid)
      const step = Math.floor((hov.x - gutter + sx) / zx / gs) * gs
      if (step >= 0 && step < r.steps) {
        g.fillStyle = 'rgba(255,255,255,0.13)'
        g.fillRect(gutter + step * zx - sx, 0, gs * zx, ruler)
      }
    }
    g.textBaseline = 'middle'
    const beatW = zx * 4
    for (let s = s0 - (s0 % 4); s <= s1; s += 4) {
      const x = Math.round(gutter + s * zx - sx)
      if (s % r.spb === 0) {
        g.fillStyle = 'rgba(0,244,142,0.55)'
        g.fillRect(x, u(3), 1, ruler)
        if (s < r.steps) {
          g.fillStyle = '#9cffd5'
          g.font = `${Math.round(15 * k)}px "VT323", monospace`
          g.fillText(String(s / r.spb + 1), x + u(4), ruler / 2 + 1)
        }
      } else if (beatW >= 22 * k) {
        g.fillStyle = 'rgba(0,244,142,0.3)'
        g.fillRect(x, ruler - u(6), 1, u(6))
        if (beatW >= 40 * k && s < r.steps) {
          g.fillStyle = 'rgba(156,255,213,0.4)'
          g.font = `${Math.round(12 * k)}px "VT323", monospace`
          g.fillText(String((s % r.spb) / 4 + 1), x + u(3), ruler / 2 + 1)
        }
      }
    }
    g.restore()

    // ── carril de velocidad ──
    g.fillStyle = '#050d0a'
    g.fillRect(gutter, areaBottom, w - gutter, velH)
    g.save()
    g.beginPath()
    g.rect(gutter, areaBottom, w - gutter, velH)
    g.clip()
    const velTop = velH - u(8)
    g.fillStyle = 'rgba(0,244,142,0.07)'
    g.fillRect(gutter, areaBottom + velH - u(3) - velTop / 2, w - gutter, 1)
    const velBase = drag?.kind === 'vel' ? r.notes[drag.index] : undefined
    const velGroup = drag?.kind === 'vel' && sel.has(drag.index)
    r.notes.forEach((n, i) => {
      const x = Math.round(gutter + n.step * zx - sx)
      if (x < gutter - u(10) || x > w) return
      let v = n.vel
      if (drag?.kind === 'vel' && velBase && (i === drag.index || (velGroup && sel.has(i)))) v = Math.max(1, Math.min(15, n.vel + drag.vel - velBase.vel))
      const hh = Math.max(2, (v / 15) * velTop)
      const bw = Math.max(u(3), Math.min(zx - 2, u(5)))
      const y0 = areaBottom + velH - u(3) - hh
      g.fillStyle = sel.has(i) ? '#ffffff' : col
      g.globalAlpha = 0.5
      g.fillRect(x, y0, bw, hh)
      g.globalAlpha = 1
      g.fillRect(x, y0, Math.max(bw, Math.min(n.len * zx - 2, u(10))), u(2))
    })
    g.restore()

    // ── cabezal ──
    const st = engine.status
    if (r.playing) {
      const pid = r.loopPattern ? r.pattern.id : r.song.order[st.pos.order]
      if (pid === r.pattern.id) {
        const absX = gutter + (st.pos.step + st.pos.frac) * zx
        const px = absX - sx
        if (px >= gutter && px <= w) {
          g.fillStyle = 'rgba(255,255,255,0.1)'
          g.fillRect(px - u(3), ruler, u(6), h - ruler)
          g.fillStyle = '#ffffff'
          g.fillRect(px - 0.75 * k, ruler, 1.5 * k, h - ruler)
          g.beginPath()
          g.moveTo(px - u(5), u(2))
          g.lineTo(px + u(5), u(2))
          g.lineTo(px, ruler - 1)
          g.fill()
        }
        if (r.followPlay && !drag && (px > w - 30 * k || px < gutter)) wrap.scrollLeft = Math.max(0, absX - gutter - 20 * k)
      }
    }

    // ── teclas (columna izquierda) ──
    g.fillStyle = '#060f0c'
    g.fillRect(0, 0, gutter, h)
    g.save()
    g.beginPath()
    g.rect(0, areaTop, gutter, areaH)
    g.clip()
    const heldSet = new Set(r.held)
    const keyW = gutter - 1
    const blackW = Math.round(keyW * 0.6)
    for (let row = firstRow; row <= lastRow; row++) {
      const y = areaTop + row * rowH - sy
      const note = noteOfRow(row, r.L)
      const lit = heldSet.has(note)
      const hot = row === hovRow
      if (r.L.drum) {
        const name = r.track.kind === 'dac' ? r.song.drumKit[row]?.name : r.song.noiseKit[row]?.name
        g.fillStyle = lit ? col : hot ? 'rgba(255,255,255,0.1)' : row % 2 === 0 ? 'rgba(0,244,142,0.06)' : 'rgba(0,244,142,0.025)'
        g.fillRect(0, y, keyW, rowH - 1)
        g.textBaseline = 'middle'
        g.fillStyle = lit ? '#04120c' : col
        g.font = `700 ${Math.round(9 * k)}px "Space Mono", monospace`
        g.fillText((name ?? '').slice(0, 8), u(6), y + rowH / 2)
        const pk = PAD_KEYS[row]
        if (pk) {
          g.globalAlpha = 0.5
          g.textAlign = 'right'
          g.font = `${Math.round(12 * k)}px "VT323", monospace`
          g.fillText(pk.toUpperCase(), keyW - u(4), y + rowH / 2 + 1)
          g.textAlign = 'left'
          g.globalAlpha = 1
        }
        continue
      }
      const black = isBlackKey(note)
      const pc = ((note % 12) + 12) % 12
      g.fillStyle = lit && !black ? '#00f48e' : hot && !black ? WHITE_KEY_HOVER : WHITE_KEY
      g.fillRect(0, y, keyW, rowH)
      if (black) {
        g.fillStyle = lit ? '#00c873' : hot ? BLACK_KEY_HOVER : BLACK_KEY
        g.fillRect(0, y, blackW, rowH)
        // las blancas vecinas se juntan por detrás de la negra
        g.fillStyle = 'rgba(6,30,20,0.4)'
        g.fillRect(blackW, Math.round(y + rowH / 2), keyW - blackW, 1)
      } else if (pc === 0 || pc === 5) {
        // Mi/Fa y Si/Do: dos blancas contiguas
        g.fillStyle = 'rgba(6,30,20,0.5)'
        g.fillRect(0, y + rowH - 1, keyW, 1)
      }
      if ((((note - r.song.key) % 12) + 12) % 12 === 0) {
        g.fillStyle = black ? '#00f48e' : '#009a5a'
        g.fillRect(0, y + 1, u(3), rowH - 2)
      }
      if (pc === 0 || (!black && rowH >= 13 * k)) {
        g.fillStyle = pc === 0 ? '#052416' : 'rgba(8,48,32,0.58)'
        g.font = `${pc === 0 ? 700 : 400} ${fontPx}px "Space Mono", monospace`
        g.textBaseline = 'middle'
        g.textAlign = 'right'
        g.fillText(noteName(note), keyW - u(4), y + rowH / 2 + 0.5)
        g.textAlign = 'left'
      }
    }
    g.restore()

    // ── esquinas y bordes ──
    g.fillStyle = '#07110e'
    g.fillRect(0, 0, gutter, ruler)
    g.fillRect(0, areaBottom, gutter, velH)
    g.fillStyle = 'rgba(0,244,142,0.32)'
    g.fillRect(gutter - 1, 0, 1, h)
    g.fillRect(0, ruler - 1, w, 1)
    g.fillRect(0, areaBottom, w, 1)
    g.textBaseline = 'middle'
    g.font = `${Math.round(8 * k)}px "Press Start 2P", monospace`
    g.fillStyle = 'rgba(0,244,142,0.8)'
    g.fillText(drag?.kind === 'vel' ? `V ${drag.vel}` : 'VEL', u(7), areaBottom + velH / 2)
    // esquina superior: la nota bajo el cursor o el nombre del patrón
    const overRow = hov !== null && hovRow >= 0 && hovRow < r.L.rows
    if (overRow && !r.L.drum) {
      g.fillStyle = '#ffffff'
      g.fillText(noteName(noteOfRow(hovRow, r.L)), u(7), ruler / 2 + 1)
    } else {
      g.fillStyle = 'rgba(156,255,213,0.85)'
      g.fillText(r.pattern.name.slice(0, 6), u(7), ruler / 2 + 1)
    }
  }, [])

  // ── bucle de render: solo dibuja si hay cambios o está sonando ──
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (dirtyRef.current || ref.current.playing) {
        dirtyRef.current = false
        draw()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  useEffect(invalidate)

  // tamaño del canvas
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      setViewH(h)
      if (!autoZoomDone && w > 0) {
        // primera vez: deja 4 compases a la vista, sea cual sea la resolución
        autoZoomDone = true
        const r = ref.current
        const fit4 = (w / r.G.k - D.gutter - 8) / (4 * r.spb)
        useApp.getState().set({ zoom: clampZoom(Math.max(10, Math.min(26, fit4))) })
      }
      dirtyRef.current = true
    }
    // el observador avisa nada más empezar, con el tamaño inicial
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // centra verticalmente al cambiar de pista/patrón
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const { L: l, G: geo } = ref.current
    const arr = pattern.notes[track.id] ?? []
    let centerNote = l.drum ? 0 : 60
    if (arr.length && !l.drum) centerNote = arr.reduce((a, n) => a + n.note, 0) / arr.length
    const areaH = wrap.clientHeight - geo.ruler - geo.vel
    wrap.scrollTop = Math.max(0, rowOfNote(centerNote, l) * l.rowH - areaH / 2)
    wrap.scrollLeft = 0
    dirtyRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, pattern.id])

  // tras un cambio de zoom, recoloca el scroll para que el punto de anclaje no se mueva
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const a = anchorRef.current
    if (!wrap || !a) return
    anchorRef.current = null
    if (a.step !== undefined && a.mx !== undefined) wrap.scrollLeft = Math.max(0, a.step * G.zx + G.gutter - a.mx)
    if (a.row !== undefined) wrap.scrollTop = Math.max(0, a.row * L.rowH - (wrap.clientHeight - G.ruler - G.vel) / 2)
  }, [G, L])

  // ── coordenadas ──
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const stepAt = (x: number, sx: number) => (x - ref.current.G.gutter + sx) / ref.current.G.zx
  const hitNote = (x: number, y: number): { index: number; edge: boolean } | null => {
    const r = ref.current
    const wrap = wrapRef.current!
    const { gutter, ruler, zx, k } = r.G
    const sx = wrap.scrollLeft
    const sy = wrap.scrollTop
    for (let i = r.notes.length - 1; i >= 0; i--) {
      const n = r.notes[i]
      const nx = gutter + n.step * zx - sx
      const ny = ruler + rowOfNote(n.note, r.L) * r.L.rowH - sy
      const nw = Math.max(zx * 0.5, n.len * zx - 1)
      if (x >= nx && x <= nx + nw && y >= ny && y <= ny + r.L.rowH) return { index: i, edge: x > nx + nw - 7 * k && nw > 12 * k }
    }
    return null
  }

  const snapStep = (s: number, down = true): number => {
    const g = Math.max(1, ref.current.grid)
    return (down ? Math.floor(s / g) : Math.round(s / g)) * g
  }

  const fixPitch = (note: number): number => {
    const r = ref.current
    let n = Math.max(r.L.lo, Math.min(r.L.hi, note))
    if (r.scaleLock && !r.L.drum) n = snapToScale(n, r.song.key, r.song.scale)
    return Math.max(r.L.lo, Math.min(r.L.hi, n))
  }

  const velAt = (y: number): number => {
    const { k, vel } = ref.current.G
    return Math.max(1, Math.min(15, Math.round(((sizeRef.current.h - 3 * k - y) / (vel - 8 * k)) * 15)))
  }

  const trackIdx = () => ref.current.song.tracks.findIndex((t) => t.id === ref.current.track.id)

  const commitMove = (d: Extract<Drag, { kind: 'move' }>) => {
    const r = ref.current
    const patId = r.pattern.id
    const tid = r.track.id
    const src = r.notes
    const moved = d.indices.map((i) => src[i]).filter(Boolean)
    const result: Note[] = []
    edit((draft) => {
      const p = getPattern(draft, patId)
      if (!p) return
      const arr = p.notes[tid] ?? (p.notes[tid] = [])
      if (!d.copy) {
        for (const i of [...d.indices].sort((a, b) => b - a)) arr.splice(i, 1)
      }
      const max = patternSteps(draft, p)
      for (const n of moved) {
        const nn: Note = {
          ...n,
          step: Math.max(0, Math.min(max - 1, n.step + d.dx)),
          note: fixPitch(n.note + d.dy),
        }
        addNote(draft, patId, tid, nn)
        result.push(nn)
      }
    })
    // reselecciona las notas movidas
    const after = getPattern(useApp.getState().song, patId)?.notes[tid] ?? []
    const idx: number[] = []
    for (const m of result) {
      const k = after.findIndex((n) => n.step === m.step && n.note === m.note)
      if (k >= 0) idx.push(k)
    }
    setSelNotes(idx)
  }

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = ref.current
    const wrap = wrapRef.current!
    wrap.focus({ preventScroll: true })
    capturePointer(e)
    const { x, y } = toLocal(e)
    const { gutter, ruler, vel: velH } = r.G
    const rowH = r.L.rowH
    const sx = wrap.scrollLeft
    const sy = wrap.scrollTop
    const h = sizeRef.current.h

    // teclas → preescucha
    if (x < gutter && y > ruler && y < h - velH) {
      const row = Math.floor((y - ruler + sy) / rowH)
      if (row >= 0 && row < r.L.rows) void engine.preview(trackIdx(), noteOfRow(row, r.L), r.noteVel)
      return
    }
    // regla → reproducir desde aquí
    if (y <= ruler && x >= gutter) {
      const idx = r.song.order.indexOf(r.pattern.id)
      const step = Math.max(0, Math.min(r.steps - 1, Math.floor(stepAt(x, sx))))
      if (idx >= 0) void playFrom(idx, step)
      else useApp.getState().notify('Este patrón no está en el orden: añádelo con + para reproducirlo desde aquí')
      return
    }
    // carril de velocidad
    if (y >= h - velH && x >= gutter) {
      const s = Math.floor(stepAt(x, sx))
      // la nota más cercana a ese paso (como mucho a un paso de distancia)
      let bestStep = -1
      let dm = 1e9
      for (const n of r.notes) {
        const d = Math.abs(n.step - s)
        if (d < dm || (d === dm && n.step <= s)) {
          dm = d
          bestStep = n.step
        }
      }
      if (bestStep < 0 || dm > 1) return
      // en un acorde manda la nota seleccionada; si no, la más aguda
      let best = -1
      let bestSel = false
      r.notes.forEach((n, i) => {
        if (n.step !== bestStep) return
        const isSel = r.selNotes.includes(i)
        if (best < 0 || isSel || !bestSel) {
          best = i
          bestSel = isSel
        }
      })
      if (best >= 0) {
        dragRef.current = { kind: 'vel', index: best, vel: velAt(y) }
        invalidate()
      }
      return
    }
    if (x < gutter) return

    const hit = hitNote(x, y)
    const rightClick = e.button === 2
    if (hit && (rightClick || e.altKey)) {
      // borrar
      const idxs = r.selNotes.includes(hit.index) ? r.selNotes : [hit.index]
      const patId = r.pattern.id
      const tid = r.track.id
      edit((d) => {
        const p = getPattern(d, patId)
        const arr = p?.notes[tid]
        if (arr) for (const i of [...idxs].sort((a, b) => b - a)) arr.splice(i, 1)
      })
      setSelNotes([])
      hoverRef.current = null
      return
    }
    if (hit) {
      let indices = r.selNotes
      if (e.shiftKey) {
        indices = indices.includes(hit.index) ? indices.filter((i) => i !== hit.index) : [...indices, hit.index]
        setSelNotes(indices)
        if (!indices.includes(hit.index)) return
      } else if (!indices.includes(hit.index)) {
        indices = [hit.index]
        setSelNotes(indices)
      }
      const n = r.notes[hit.index]
      void engine.preview(trackIdx(), n.note, n.vel)
      if (hit.edge) dragRef.current = { kind: 'resize', indices, ox: x, dLen: 0 }
      else dragRef.current = { kind: 'move', indices, ox: x, oy: y, dx: 0, dy: 0, copy: e.ctrlKey || e.metaKey }
      invalidate()
      return
    }
    if (rightClick) return
    if (e.shiftKey) {
      dragRef.current = { kind: 'rubber', x0: x, y0: y, x1: x, y1: y, add: true }
      invalidate()
      return
    }
    // crear nota nueva
    const step = Math.max(0, Math.min(r.steps - 1, snapStep(stepAt(x, sx))))
    const row = Math.floor((y - ruler + sy) / rowH)
    if (row < 0 || row >= r.L.rows) {
      setSelNotes([])
      return
    }
    const note = fixPitch(noteOfRow(row, r.L))
    const len = r.L.drum ? 1 : Math.min(r.noteLen, r.steps - step)
    dragRef.current = { kind: 'create', step, note, len }
    setSelNotes([])
    void engine.preview(trackIdx(), note, r.noteVel)
    invalidate()
  }

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = ref.current
    const wrap = wrapRef.current!
    const { x, y } = toLocal(e)
    const { gutter, ruler, vel: velH, zx } = r.G
    const rowH = r.L.rowH
    const d = dragRef.current
    const sx = wrap.scrollLeft
    if (!d) {
      const h = sizeRef.current.h
      const hit = x > gutter && y > ruler && y < h - velH ? hitNote(x, y) : null
      hoverRef.current = { x, y, onNote: hit !== null }
      canvasRef.current!.style.cursor = hit ? (hit.edge ? 'ew-resize' : 'grab') : x < gutter || y <= ruler ? 'pointer' : y >= h - velH ? 'ns-resize' : 'crosshair'
      invalidate()
      return
    }
    const gs = Math.max(1, r.grid)
    if (d.kind === 'move') {
      d.dx = Math.round((x - d.ox) / zx / gs) * gs
      const rows = Math.round((y - d.oy) / rowH)
      d.dy = r.L.drum ? rows : -rows
      canvasRef.current!.style.cursor = 'grabbing'
    } else if (d.kind === 'resize') {
      d.dLen = Math.round((x - d.ox) / zx / gs) * gs
    } else if (d.kind === 'create') {
      const endStep = snapStep(stepAt(x, sx), false)
      if (r.L.drum) {
        // batería: arrastrar "pinta" un golpe en cada paso de la rejilla
        d.len = endStep <= d.step ? 1 : Math.min(r.steps - d.step, Math.max(gs, endStep - d.step))
      } else if (endStep <= d.step) d.len = Math.max(1, Math.min(r.noteLen, r.steps - d.step))
      else d.len = Math.max(1, Math.min(r.steps - d.step, Math.max(gs, endStep - d.step)))
    } else if (d.kind === 'rubber') {
      d.x1 = x
      d.y1 = y
    } else if (d.kind === 'vel') {
      d.vel = velAt(y)
    }
    invalidate()
  }

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = ref.current
    const d = dragRef.current
    dragRef.current = null
    try {
      ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    if (!d) return
    const patId = r.pattern.id
    const tid = r.track.id
    const { gutter, ruler, zx } = r.G
    if (d.kind === 'create') {
      if (r.L.drum) {
        const gs = Math.max(1, r.grid)
        edit((draft) => {
          for (let s = d.step; s < d.step + d.len; s += gs) addNote(draft, patId, tid, { step: s, len: 1, note: d.note, vel: r.noteVel })
        })
      } else {
        edit((draft) => addNote(draft, patId, tid, { step: d.step, len: d.len, note: d.note, vel: r.noteVel }))
        // recuerda la longitud usada si se arrastró
        if (d.len !== r.noteLen && d.len > 1) set({ noteLen: d.len })
      }
      const arr = getPattern(useApp.getState().song, patId)?.notes[tid] ?? []
      const k = arr.findIndex((n) => n.step === d.step && n.note === d.note)
      if (k >= 0) setSelNotes([k])
    } else if (d.kind === 'move') {
      if (d.dx !== 0 || d.dy !== 0) commitMove(d)
    } else if (d.kind === 'resize') {
      if (d.dLen !== 0) {
        edit((draft) => {
          const p = getPattern(draft, patId)
          const arr = p?.notes[tid]
          if (!p || !arr) return
          const max = patternSteps(draft, p)
          for (const i of d.indices) {
            const n = arr[i]
            if (n) n.len = Math.max(1, Math.min(max - n.step, n.len + d.dLen))
          }
        }, 'resize')
      }
    } else if (d.kind === 'rubber') {
      const wrap = wrapRef.current!
      const sx = wrap.scrollLeft
      const sy = wrap.scrollTop
      const x0 = Math.min(d.x0, d.x1)
      const x1 = Math.max(d.x0, d.x1)
      const y0 = Math.min(d.y0, d.y1)
      const y1 = Math.max(d.y0, d.y1)
      const picked: number[] = [...r.selNotes]
      r.notes.forEach((n, i) => {
        const nx = gutter + n.step * zx - sx
        const ny = ruler + rowOfNote(n.note, r.L) * r.L.rowH - sy
        const nw = n.len * zx
        if (nx < x1 && nx + nw > x0 && ny < y1 && ny + r.L.rowH > y0 && !picked.includes(i)) picked.push(i)
      })
      setSelNotes(picked)
    } else if (d.kind === 'vel') {
      edit((draft) => {
        const arr = getPattern(draft, patId)?.notes[tid]
        const n = arr?.[d.index]
        if (n) {
          const delta = d.vel - n.vel
          const targets = r.selNotes.includes(d.index) ? r.selNotes : [d.index]
          for (const i of targets) {
            const m = arr?.[i]
            if (m) m.vel = Math.max(1, Math.min(15, m.vel + delta))
          }
        }
      }, 'vel')
    }
    invalidate()
  }

  const onKeyDown = (e: RKeyEvent<HTMLDivElement>) => {
    const r = ref.current
    const patId = r.pattern.id
    const tid = r.track.id
    const mod = e.ctrlKey || e.metaKey
    const sel = r.selNotes
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (mod && e.key.toLowerCase() === 'a') {
      stop()
      setSelNotes(r.notes.map((_, i) => i))
      return
    }
    if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
      if (sel.length === 0) return
      stop()
      const picked = sel.map((i) => r.notes[i]).filter(Boolean)
      const minStep = Math.min(...picked.map((n) => n.step))
      set({ clipboard: { trackKind: r.track.kind, notes: picked.map((n) => ({ ...n, step: n.step - minStep })) } })
      if (e.key.toLowerCase() === 'x') {
        edit((d) => {
          const arr = getPattern(d, patId)?.notes[tid]
          if (arr) for (const i of [...sel].sort((a, b) => b - a)) arr.splice(i, 1)
        })
        setSelNotes([])
      }
      return
    }
    if (mod && e.key.toLowerCase() === 'v') {
      const clip = useApp.getState().clipboard
      if (!clip) return
      stop()
      // pega en el primer paso libre tras el cursor de selección, o en 0
      const base = sel.length ? Math.max(...sel.map((i) => r.notes[i].step + r.notes[i].len)) : 0
      edit((d) => {
        for (const n of clip.notes) addNote(d, patId, tid, { ...n, step: n.step + base })
      })
      return
    }
    if (mod && e.key.toLowerCase() === 'd') {
      if (sel.length === 0) return
      stop()
      const picked = sel.map((i) => r.notes[i]).filter(Boolean)
      const minStep = Math.min(...picked.map((n) => n.step))
      const maxEnd = Math.max(...picked.map((n) => n.step + n.len))
      const span = maxEnd - minStep
      edit((d) => {
        for (const n of picked) addNote(d, patId, tid, { ...n, step: n.step + span })
      })
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel.length === 0) return
      stop()
      edit((d) => {
        const arr = getPattern(d, patId)?.notes[tid]
        if (arr) for (const i of [...sel].sort((a, b) => b - a)) arr.splice(i, 1)
      })
      setSelNotes([])
      return
    }
    if (e.key.toLowerCase() === 'q' && !mod) {
      stop()
      edit((d) => quantizeNotes(d, patId, tid, Math.max(1, r.grid)))
      return
    }
    if (e.key.toLowerCase() === 'b' && !mod) {
      // ligar: las notas seleccionadas no vuelven a atacar (si ya lo están todas, se sueltan)
      if (sel.length === 0 || r.L.drum) return
      stop()
      const all = sel.every((i) => r.notes[i]?.slide)
      edit((d) => {
        const arr = getPattern(d, patId)?.notes[tid]
        if (!arr) return
        for (const i of sel) {
          const n = arr[i]
          if (!n) continue
          if (all) delete n.slide
          else n.slide = true
        }
      })
      return
    }
    if (e.key.startsWith('Arrow') && sel.length) {
      stop()
      const dStep = e.key === 'ArrowRight' ? Math.max(1, r.grid) : e.key === 'ArrowLeft' ? -Math.max(1, r.grid) : 0
      let dNote = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
      if (e.shiftKey && dNote) dNote *= 12
      if (r.L.drum) dNote = -dNote
      const picked = sel.map((i) => r.notes[i]).filter(Boolean)
      const moved = picked.map((n) => ({ ...n, step: n.step + dStep, note: n.note + dNote }))
      edit((d) => {
        const arr = getPattern(d, patId)?.notes[tid]
        if (!arr) return
        for (const i of [...sel].sort((a, b) => b - a)) arr.splice(i, 1)
        for (const n of moved) {
          if (n.step < 0) continue
          addNote(d, patId, tid, { ...n, note: Math.max(r.L.lo, Math.min(r.L.hi, n.note)) })
        }
      }, 'nudge')
      // mantén la selección sobre las notas movidas
      const after = getPattern(useApp.getState().song, patId)?.notes[tid] ?? []
      const idx = moved.map((m) => after.findIndex((n) => n.step === m.step && n.note === Math.max(r.L.lo, Math.min(r.L.hi, m.note)))).filter((i) => i >= 0)
      setSelNotes(idx)
    }
  }

  // ── zoom ──
  const zoomTo = (z: number, mx?: number) => {
    const wrap = wrapRef.current
    const r = ref.current
    const z1 = clampZoom(z)
    if (!wrap || z1 === r.zoom) return
    const ax = mx ?? (r.G.gutter + wrap.clientWidth) / 2
    anchorRef.current = { step: (ax - r.G.gutter + wrap.scrollLeft) / r.G.zx, mx: ax }
    set({ zoom: z1 })
  }
  const fit = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    const r = ref.current
    // redondeo a la baja (pasos de 0,5) para que quepa entero, margen final incluido
    const z1 = clampZoom(Math.floor(((wrap.clientWidth / r.G.k - D.gutter - D.pad) / r.steps) * 2) / 2)
    if (z1 === r.zoom) wrap.scrollLeft = 0
    else {
      anchorRef.current = { step: 0, mx: r.G.gutter }
      set({ zoom: z1 })
    }
  }
  const rowZoom = (delta: number) => {
    const wrap = wrapRef.current
    const r = ref.current
    const next = Math.max(ROW_MIN, Math.min(ROW_MAX, rowHBase + delta))
    if (!wrap || next === rowHBase) return
    anchorRef.current = { row: (wrap.scrollTop + (wrap.clientHeight - r.G.ruler - r.G.vel) / 2) / r.L.rowH }
    set({ rowH: next })
  }

  // rueda: Ctrl = zoom horizontal anclado al cursor · Shift = desplazamiento horizontal
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = ref.current
        const z1 = clampZoom(r.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
        if (z1 === r.zoom) return
        const mx = Math.max(r.G.gutter, e.clientX - wrap.getBoundingClientRect().left)
        anchorRef.current = { step: (mx - r.G.gutter + wrap.scrollLeft) / r.G.zx, mx }
        useApp.getState().set({ zoom: z1 })
      } else if (e.shiftKey) {
        e.preventDefault()
        wrap.scrollLeft += e.deltaY
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="roll-wrap" style={{ '--tc': KIND_COLOR[track.kind] } as CSSProperties}>
      <RollToolbar ghost={ghost} setGhost={setGhost} drum={L.drum} />
      <div className="roll">
        <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} onScroll={invalidate} onContextMenu={(e) => e.preventDefault()} className="roll-scroll" aria-label="Piano roll">
          <div style={{ width: contentW, height: contentH }} />
          <canvas
            ref={canvasRef}
            className="touch-none"
            style={{ position: 'sticky', left: 0, top: 0, display: 'block', marginTop: -contentH }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
              if (hoverRef.current) {
                hoverRef.current = null
                invalidate()
              }
            }}
          />
        </div>
        <div className="roll-zoom" role="group" aria-label="Zoom del piano roll">
          <button className="btn icon sm ghost" onClick={() => zoomTo(zoom / 1.25)} disabled={zoom <= ZOOM_MIN} title="Alejar (Ctrl + rueda)" aria-label="Alejar">
            {Icon.minus}
          </button>
          <button className="btn icon sm ghost" onClick={fit} title="Ver el patrón entero" aria-label="Ajustar el patrón al ancho">
            {Icon.fit}
          </button>
          <button className="btn icon sm ghost" onClick={() => zoomTo(zoom * 1.25)} disabled={zoom >= ZOOM_MAX} title="Acercar (Ctrl + rueda)" aria-label="Acercar">
            {Icon.plus}
          </button>
          {!L.drum && (
            <>
              <i />
              <button className="btn icon sm ghost" onClick={() => rowZoom(-2)} disabled={rowHBase <= ROW_MIN} title="Filas más bajas: se ven más octavas" aria-label="Filas más bajas">
                {Icon.down}
              </button>
              <button className="btn icon sm ghost" onClick={() => rowZoom(2)} disabled={rowHBase >= ROW_MAX} title="Filas más altas" aria-label="Filas más altas">
                {Icon.up}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RollToolbar({ ghost, setGhost, drum }: { ghost: boolean; setGhost: (v: boolean) => void; drum: boolean }) {
  const noteLen = useApp((s) => s.noteLen)
  const noteVel = useApp((s) => s.noteVel)
  const grid = useApp((s) => s.grid)
  const scaleLock = useApp((s) => s.scaleLock)
  const track = useApp(selectTrackObj)
  const pattern = useApp(selectPatternObj)
  const edit = useApp((s) => s.edit)
  const set = useApp((s) => s.set)
  const selNotes = useApp((s) => s.selNotes)
  const setSelNotes = useApp((s) => s.setSelNotes)
  const compact = useMediaQuery('(max-width: 760px)')
  const target = selNotes.length ? `las ${selNotes.length} notas seleccionadas` : 'toda la pista'

  // articulación de las notas seleccionadas: ligadura (FM y PSG) y panorama propio (FM y batería;
  // el PSG de la Mega Drive es mono)
  const notes = pattern.notes[track.id] ?? []
  const picked = selNotes.map((i) => notes[i]).filter((n): n is Note => n !== undefined)
  const canSlide = track.kind === 'fm' || track.kind === 'psg'
  const canPan = track.kind === 'fm' || track.kind === 'dac'
  const artOpen = picked.length > 0 && (canSlide || canPan) && !compact
  const allSlide = picked.length > 0 && picked.every((n) => n.slide)
  /** panorama propio común a toda la selección (si lo hay) */
  const pan: Pan | undefined = picked.length > 0 && picked.every((n) => n.pan === picked[0].pan) ? picked[0].pan : undefined
  const PAN_TIP: Record<Pan, string> = { L: 'solo por la izquierda', C: 'al centro', R: 'solo por la derecha' }
  const eachSelected = (fn: (n: Note) => void) =>
    edit((d) => {
      const arr = getPattern(d, pattern.id)?.notes[track.id]
      if (!arr) return
      for (const i of selNotes) if (arr[i]) fn(arr[i])
    })

  const transpose = (semis: number) => {
    const idx = selNotes.length ? selNotes : (pattern.notes[track.id] ?? []).map((_, i) => i)
    edit((d) => {
      const arr = getPattern(d, pattern.id)?.notes[track.id]
      if (!arr) return
      for (const i of idx) if (arr[i]) arr[i].note = Math.max(0, Math.min(127, arr[i].note + semis))
    })
  }

  return (
    <div className="roll-tb">
      {/* qué se dibuja: pista, rejilla, duración y velocidad de las notas nuevas */}
      <div className="roll-tb-a">
        <div className="grp roll-who" title="Pista que se edita · cámbiala con 1–9, 0">
          <span className="trk-tag">
            {KIND_TAG[track.kind]}
            {track.kind === 'noise' ? '' : track.ch + 1}
          </span>
          <b>{track.name}</b>
        </div>
        <div className="grp">
          <span className="label">GRID</span>
          <Segmented
            value={grid}
            onChange={(v) => set({ grid: v })}
            options={[
              { value: 1, label: '1/16', title: 'Rejilla de semicorcheas' },
              { value: 2, label: '1/8', title: 'Rejilla de corcheas' },
              { value: 4, label: '1/4', title: 'Rejilla de negras' },
            ]}
            label="Rejilla"
          />
        </div>
        {!drum && (
          <div className="grp">
            <span className="label">LARGO</span>
            <Segmented value={noteLen} onChange={(v) => set({ noteLen: v })} options={[1, 2, 4, 8, 16].map((v) => ({ value: v, label: String(v), title: `Las notas nuevas duran ${v} paso${v > 1 ? 's' : ''}` }))} label="Duración de las notas nuevas" />
          </div>
        )}
        <div className="grp">
          <span className="label">VEL</span>
          <BarSlider className="roll-vel" value={noteVel} min={1} max={15} def={12} color="color-mix(in srgb, var(--tc) 45%, transparent)" title="Velocidad de las notas nuevas (1–15) · doble clic = 12" label="Velocidad de las notas nuevas" onChange={(v) => set({ noteVel: v })} />
        </div>
      </div>
      {/* ayudas y acciones: si no caben en la misma fila, bajan juntas a la siguiente */}
      <div className="roll-tb-b">
        {artOpen ? (
          // con notas seleccionadas, las ayudas dejan su sitio a la articulación de esas notas
          <div className="grp roll-art">
            {canSlide && (
              <button
                className={cx('btn sm', allSlide && 'on')}
                onClick={() =>
                  eachSelected((n) => {
                    if (allSlide) delete n.slide
                    else n.slide = true
                  })
                }
                aria-pressed={allSlide}
                title="Liga las notas seleccionadas a la que venía sonando: no vuelven a atacar y, si la pista tiene GLIDE, el tono se desliza hasta ellas · tecla B"
              >
                LIGAR
              </button>
            )}
            {canPan && (
              // tres botones que se apagan al volver a pulsarlos: sin ninguno, vale el panorama de la pista
              <div className="seg" role="group" aria-label="Panorama propio de las notas seleccionadas">
                {(['L', 'C', 'R'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={cx(pan === p && 'sel')}
                    aria-pressed={pan === p}
                    title={`Panorama de las notas seleccionadas: ${PAN_TIP[p]} · otro clic las devuelve al de la pista`}
                    onClick={() =>
                      eachSelected((n) => {
                        if (pan === p) delete n.pan
                        else n.pan = p
                      })
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          !drum &&
          !compact && (
            <div className="grp">
              <button className={cx('btn sm', scaleLock && 'on')} onClick={() => set({ scaleLock: !scaleLock })} aria-pressed={scaleLock} title="Fuerza las notas nuevas a la escala de la canción">
                ESCALA
              </button>
              <button className={cx('btn sm', ghost && 'on')} onClick={() => setGhost(!ghost)} aria-pressed={ghost} title="Muestra de fondo las notas de las otras pistas">
                FANTASMA
              </button>
            </div>
          )
        )}
        <div className="grp roll-acts">
          {!drum && !compact && (
            <div className="seg" role="group" aria-label="Transponer">
              <button onClick={() => transpose(-12)} title={`Una octava abajo · ${target}`}>
                −8ª
              </button>
              <button onClick={() => transpose(-1)} title={`Un semitono abajo · ${target}`}>
                −1
              </button>
              <button onClick={() => transpose(1)} title={`Un semitono arriba · ${target}`}>
                +1
              </button>
              <button onClick={() => transpose(12)} title={`Una octava arriba · ${target}`}>
                +8ª
              </button>
            </div>
          )}
          <button className="btn sm" onClick={() => edit((d) => quantizeNotes(d, pattern.id, track.id, Math.max(1, grid)))} title="Cuantiza la pista a la rejilla (Q)">
            CUANT.
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              edit((d) => setTrackNotes(d, pattern.id, track.id, []))
              setSelNotes([])
            }}
            title="Borra todas las notas de esta pista en este patrón"
          >
            LIMPIAR
          </button>
        </div>
      </div>
    </div>
  )
}
