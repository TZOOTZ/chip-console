// Genera, a partir del logotipo (src/ui/logoShapes.ts) y sin dependencias:
//   public/logo.svg              el logo vectorial limpio
//   public/icon.svg              favicon
//   public/icon-192.png · icon-512.png     iconos de la PWA (esquinas redondeadas)
//   public/icon-maskable-512.png           icono "maskable" (a sangre, con zona segura)
//   public/apple-touch-icon.png            180 px, opaco (iOS redondea por su cuenta)
//   rom/player/res/logo.png                el logo para la ROM de Mega Drive (112×72, 16 colores indexados)
// Uso: node scripts/make-icons.mjs   (Node ≥ 23.6: importa el .ts directamente)
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { LOGO_CIRCLE, LOGO_H, LOGO_SWOOSH, LOGO_TREFOIL, LOGO_W } from '../src/ui/logoShapes.ts'

const BG = [4, 7, 10]
const TOP = [125, 255, 196] // --accent-hi
const BOTTOM = [0, 244, 142] // --accent
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

// ── trazados SVG → polígonos ────────────────────────────────────────────────
/** Aplana un trazado (M m L l H h V v C c Z z) en polígonos de puntos [x, y]. */
function flatten(d, curveSteps = 28) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  const polys = []
  let poly = []
  let x = 0
  let y = 0
  let i = 0
  let cmd = ''
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toLowerCase()) {
      case 'm':
        if (poly.length) polys.push(poly)
        x = (rel ? x : 0) + num()
        y = (rel ? y : 0) + num()
        poly = [[x, y]]
        cmd = rel ? 'l' : 'L' // los pares siguientes son líneas
        break
      case 'l':
        x = (rel ? x : 0) + num()
        y = (rel ? y : 0) + num()
        poly.push([x, y])
        break
      case 'h':
        x = (rel ? x : 0) + num()
        poly.push([x, y])
        break
      case 'v':
        y = (rel ? y : 0) + num()
        poly.push([x, y])
        break
      case 'c': {
        const ox = rel ? x : 0
        const oy = rel ? y : 0
        const [x1, y1, x2, y2, x3, y3] = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]
        for (let k = 1; k <= curveSteps; k++) {
          const t = k / curveSteps
          const u = 1 - t
          poly.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3])
        }
        x = x3
        y = y3
        break
      }
      case 'z':
        if (poly.length) {
          ;[x, y] = poly[0]
          polys.push(poly)
          poly = []
        }
        break
      default:
        throw new Error(`comando de trazado no soportado: ${cmd}`)
    }
  }
  if (poly.length) polys.push(poly)
  return polys
}

const circle = ({ cx, cy, r }, n = 160) => [Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)])]

function roundRect(size, radius, n = 24) {
  const pts = []
  const corners = [
    [size - radius, radius, -Math.PI / 2],
    [size - radius, size - radius, 0],
    [radius, size - radius, Math.PI / 2],
    [radius, radius, Math.PI],
  ]
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= n; k++) pts.push([cx + radius * Math.cos(a0 + (k / n) * (Math.PI / 2)), cy + radius * Math.sin(a0 + (k / n) * (Math.PI / 2))])
  return [pts]
}

const LOGO = [...flatten(LOGO_TREFOIL), ...circle(LOGO_CIRCLE), ...flatten(LOGO_SWOOSH)]

// ── relleno con suavizado (cobertura exacta en x, sobremuestreo en y) ───────
function coverage(size, polys, sub = 8) {
  const cov = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let j = 0; j < sub; j++) {
      const yy = y + (j + 0.5) / sub
      const xs = []
      for (const p of polys) {
        for (let k = 0; k < p.length; k++) {
          const [x0, y0] = p[k]
          const [x1, y1] = p[(k + 1) % p.length]
          if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0))
        }
      }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, xs[k])
        const xb = Math.min(size, xs[k + 1])
        for (let x = Math.floor(xa); x < xb && x < size; x++) {
          const c = Math.min(xb, x + 1) - Math.max(xa, x)
          if (c > 0) cov[y * size + x] += c / sub
        }
      }
    }
  }
  return cov
}

/** icono cuadrado: fondo (redondeado o a sangre) + logo centrado ocupando `fill` del ancho */
function icon(size, { fill, radius }) {
  const w = size * fill
  const s = w / LOGO_W
  const ox = (size - w) / 2
  const oy = (size - LOGO_H * s) / 2
  const logo = coverage(size, LOGO.map((p) => p.map(([x, y]) => [ox + x * s, oy + y * s])))
  const bg = radius > 0 ? coverage(size, roundRect(size, size * radius)) : null
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    // degradado vertical dentro de la caja del logo
    const t = Math.max(0, Math.min(1, (y - oy) / (LOGO_H * s)))
    for (let x = 0; x < size; x++) {
      const a = Math.min(1, logo[y * size + x])
      const o = (y * size + x) * 4
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(BG[c] + (TOP[c] + (BOTTOM[c] - TOP[c]) * t - BG[c]) * a)
      rgba[o + 3] = Math.round(255 * (bg ? Math.min(1, bg[y * size + x]) : 1))
    }
  }
  return png(size, rgba)
}

// ── PNG ─────────────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 6 // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ── logo para la ROM: PNG indexado con los colores que da la consola ────────────
/** fondo de la pantalla de la ROM (rom/player/src/main.c) */
const ROM_BG = [4, 16, 12]
/** la Mega Drive tiene 3 bits por canal */
const md = (v) => Math.round(Math.round((v / 255) * 7) * (255 / 7))

function romLogo(w, h) {
  const s = w / LOGO_W
  const oy = (h - LOGO_H * s) / 2
  const cov = coverage(w, LOGO.map((p) => p.map(([x, y]) => [x * s, oy + y * s])))
  const palette = [ROM_BG.map(md)]
  const index = new Map([[palette[0].join(), 0]])
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    // degradado en tres franjas y suavizado en tres pasos: caben de sobra en 16 colores
    const t = Math.min(2, Math.floor(Math.max(0, (y - oy) / (LOGO_H * s)) * 3)) / 2
    for (let x = 0; x < w; x++) {
      const a = Math.round(Math.min(1, cov[y * w + x]) * 3) / 3
      const rgb = [0, 1, 2].map((c) => md(ROM_BG[c] + (TOP[c] + (BOTTOM[c] - TOP[c]) * t - ROM_BG[c]) * a))
      let i = a === 0 ? 0 : index.get(rgb.join())
      if (i === undefined) {
        i = palette.length
        palette.push(rgb)
        index.set(rgb.join(), i)
      }
      raw[y * (w + 1) + 1 + x] = i
    }
  }
  if (palette.length > 16) throw new Error(`el logo de la ROM usa ${palette.length} colores (máximo 16)`)
  const plte = Buffer.alloc(16 * 3)
  palette.forEach((c, i) => plte.set(c, i * 3))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bits por píxel
  ihdr[9] = 3 // paleta
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ── SVG ─────────────────────────────────────────────────────────────────────
const shapes = `<path d="${LOGO_TREFOIL}"/><circle cx="${LOGO_CIRCLE.cx}" cy="${LOGO_CIRCLE.cy}" r="${LOGO_CIRCLE.r}"/><path d="${LOGO_SWOOSH}"/>`
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_W} ${LOGO_H}"><title>TZOOTZ</title>${shapes}</svg>\n`

const FAV = 64
const favScale = (FAV * 0.74) / LOGO_W
const favX = (FAV - LOGO_W * favScale) / 2
const favY = (FAV - LOGO_H * favScale) / 2
const iconSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FAV} ${FAV}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(TOP)}"/><stop offset="1" stop-color="${hex(BOTTOM)}"/></linearGradient></defs>` +
  `<rect width="${FAV}" height="${FAV}" rx="${FAV * 0.22}" fill="${hex(BG)}"/>` +
  `<g transform="translate(${favX.toFixed(3)} ${favY.toFixed(3)}) scale(${favScale.toFixed(5)})" fill="url(#g)">${shapes}</g></svg>\n`

mkdirSync('public', { recursive: true })
writeFileSync('public/logo.svg', logoSvg)
writeFileSync('public/icon.svg', iconSvg)
writeFileSync('public/icon-192.png', icon(192, { fill: 0.74, radius: 0.22 }))
writeFileSync('public/icon-512.png', icon(512, { fill: 0.74, radius: 0.22 }))
writeFileSync('public/icon-maskable-512.png', icon(512, { fill: 0.56, radius: 0 }))
writeFileSync('public/apple-touch-icon.png', icon(180, { fill: 0.68, radius: 0 }))
mkdirSync('rom/player/res', { recursive: true })
writeFileSync('rom/player/res/logo.png', romLogo(112, 72))
console.log('logo e iconos generados en public/ y rom/player/res/')
