// ── Mide la mezcla de cada estilo y pieza y reescribe src/music/mezcla-tabla.ts ───────────────────────
// Para cada generador: genera varios temas sin la tabla, escoge el tramo con más pistas sonando, mide cada
// pista sola (LUFS, BS.1770) frente al tema (fm4) y calcula cuánto mover su volumen para llegar al objetivo
// de su rol (ROLE_TARGET). Luego comprueba con otras semillas, ya con la tabla puesta.
//   npm run mezcla            → mide, escribe la tabla y valida
//   npm run mezcla -- cosmic  → solo esos generadores (la tabla conserva los demás)
import { writeFileSync } from 'node:fs'
import { measureRoles } from '../src/export/medirMezcla'
import { STYLES, generateSong, type StyleId } from '../src/music/generator'
import { targetFor } from '../src/music/mezcla'
import { MIX_TRIMS } from '../src/music/mezcla-tabla'
import { PIECES, generatePiece, type PieceId } from '../src/music/piezas'
import type { Song } from '../src/music/song'

const SR = 22050
// los estilos se miden en 40 s de su tramo más denso; las piezas son cortas y cambian mucho de un tema a
// otro, así que se miden enteras (hasta 90 s) y con más semillas
const WINDOW_S = 40
const PIECE_WINDOW_S = 90
const TRAIN = [101, 202, 303, 404, 505]
const PIECE_TRAIN = [101, 202, 303, 404, 505, 606, 707, 808]
const CHECK = [606, 707, 808]
const PIECE_CHECK = [909, 1010, 1111]

const GENERATORS: { id: string; make: (seed: number) => Song; window: number; train: number[]; check: number[] }[] = [
  ...STYLES.map((s) => ({ id: s.id, make: (seed: number) => generateSong({ style: s.id as StyleId, seed, key: seed % 12 }), window: WINDOW_S, train: TRAIN, check: CHECK })),
  ...PIECES.map((p) => ({ id: p.id, make: (seed: number) => generatePiece({ piece: p.id as PieceId, seed, key: seed % 12 }), window: PIECE_WINDOW_S, train: PIECE_TRAIN, check: PIECE_CHECK })),
]

type Reading = ReturnType<typeof measureRoles>[number]
const measure = (gen: string, song: Song, seconds: number): Reading[] => measureRoles(gen, song, seconds, SR)

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const table: Record<string, Record<string, number>> = structuredClone(MIX_TRIMS)

for (const g of GENERATORS) {
  if (only.length && !only.includes(g.id)) continue
  // sin tabla: lo que sale del generador
  delete MIX_TRIMS[g.id]
  const readings: Reading[] = []
  for (const seed of g.train) readings.push(...measure(g.id, g.make(seed), g.window))
  const trims: Record<string, number> = {}
  const lines: string[] = []
  /** trim de un grupo de lecturas: lo que falta hasta el objetivo, sin pasar del volumen 100 */
  const solve = (rs: Reading[]): { rel: number; trim: number } => {
    const target = targetFor(g.id, rs[0].role)
    const rel = median(rs.map((r) => r.rel))
    const room = 20 * Math.log10(100 / Math.max(...rs.map((r) => r.vol)))
    return { rel, trim: Math.round(Math.max(-24, Math.min(room, target - rel)) * 2) / 2 }
  }
  const group = (by: (r: Reading) => string): Map<string, Reading[]> => {
    const m = new Map<string, Reading[]>()
    for (const r of readings) m.set(by(r), [...(m.get(by(r)) ?? []), r])
    return m
  }
  const songsOf = (rs: Reading[]): number => rs.length
  // pista e instrumento (todas las melodías juntas), y la pista sola como respaldo
  const byKey = group((r) => r.key)
  for (const [key, rs] of [...byKey.entries()].sort()) {
    const { rel, trim } = solve(rs)
    if (Math.abs(trim) >= 0.5) trims[key] = trim
    lines.push(`  ${key.padEnd(24)} ${rs[0].role.padEnd(8)} ${fmt(rel).padStart(6)} LU → objetivo ${fmt(targetFor(g.id, rs[0].role)).padStart(4)} · ${fmt(trim)} dB (${songsOf(rs)} temas)`)
  }
  for (const [id, rs] of group((r) => r.id)) {
    const { trim } = solve(rs)
    if (Math.abs(trim) >= 0.5) trims[id] = trim
  }
  // con cada instrumento de tema, si sale en dos temas o más y cambia el resultado
  const leads = new Set(readings.map((r) => r.lead))
  if (leads.size > 1) {
    for (const [k, rs] of [...group((r) => `${r.key}@${r.lead}`).entries()].sort()) {
      if (rs.length < 2) continue
      const { rel, trim } = solve(rs)
      if (trim === (trims[rs[0].key] ?? 0)) continue
      trims[k] = trim
      lines.push(`  ${k.padEnd(24)} ${rs[0].role.padEnd(8)} ${fmt(rel).padStart(6)} LU → objetivo ${fmt(targetFor(g.id, rs[0].role)).padStart(4)} · ${fmt(trim)} dB (${rs.length} temas)`)
    }
  }
  table[g.id] = trims
  MIX_TRIMS[g.id] = trims
  console.log(`\n${g.id}\n${lines.join('\n')}`)
}

// valida con otras semillas, con la tabla puesta
console.log('\n── comprobación (otras semillas, con la tabla) ──')
for (const g of GENERATORS) {
  if (only.length && !only.includes(g.id)) continue
  const errs: string[] = []
  let worst = 0
  for (const seed of g.check) {
    for (const r of measure(g.id, g.make(seed), g.window)) {
      const e = r.rel - targetFor(g.id, r.role)
      if (Math.abs(e) > Math.abs(worst)) worst = e
      // por debajo y con el volumen a 100 no hay más que dar: se anota como techo, no como error
      if (e > 3 || (e < -3 && r.vol < 100)) errs.push(`${r.key} ${fmt(e)}`)
      else if (e < -3) errs.push(`${r.key} ${fmt(e)} (techo)`)
    }
  }
  console.log(`  ${g.id.padEnd(10)} peor desvío ${fmt(worst)} LU${errs.length ? ' · fuera de ±3: ' + errs.join(', ') : ''}`)
}

const body = Object.keys(table)
  .sort()
  .map((g) => {
    const rows = Object.keys(table[g])
      .sort()
      .map((k) => `    '${k}': ${table[g][k]},`)
    return `  ${g}: {\n${rows.join('\n')}\n  },`
  })
  .join('\n')
writeFileSync(
  new URL('../src/music/mezcla-tabla.ts', import.meta.url),
  `// Generado por scripts/medir-mezcla.ts (npm run mezcla): no editar a mano.\n// dB que se mueve el volumen de cada pista (clave "pista:instrumento" o "pista") para que cada rol suene\n// a su sonoridad objetivo respecto al tema.\nexport const MIX_TRIMS: Record<string, Record<string, number>> = {\n${body}\n}\n`,
)
console.log('\ntabla escrita en src/music/mezcla-tabla.ts')
