// ── Mezcla por roles: cada pista a su sitio respecto al tema ────────────────
// Los generadores escriben buenas notas, pero cada uno fijaba los volúmenes a su manera y muchas pistas de
// acompañamiento sonaban casi tan fuertes como la melodía: con más de cuatro a la vez, la mezcla se volvía
// una pared. Aquí cada pista tiene un ROL (tema, bajo, batería, segunda voz, armonía, color, doblaje, eco,
// ruido) y cada rol una sonoridad objetivo en LU respecto al tema (BS.1770, medida pista a pista). La tabla
// `MIX_TRIMS` guarda, por generador y pista, cuánto hay que mover el volumen de pista para llegar a ese
// objetivo; la recalcula `npm run mezcla` (scripts/medir-mezcla.ts) midiendo varios temas de cada estilo.
import { MIX_TRIMS } from './mezcla-tabla'
import type { Song, Track } from './song'

export type MixRole = 'lead' | 'bass' | 'drums' | 'perc' | 'counter' | 'harmony' | 'color' | 'double' | 'echo' | 'noise'

/** sonoridad objetivo de cada rol, en LU respecto al tema (0 = tan fuerte como la melodía) */
export const ROLE_TARGET: Record<MixRole, number> = {
  lead: 0,
  bass: -3,
  drums: -3,
  /** percusión de orquesta: timbales, pandereta, bodhrán */
  perc: -8,
  /** segunda voz o contramelodía (trompeta II en terceras, violín, voz 2) */
  counter: -7,
  /** cada voz de los acordes: tres juntas quedan unos 5 LU por debajo del tema */
  harmony: -11,
  /** arpegios, brillos y colores del PSG */
  color: -13,
  /** una pista que dobla la melodía (al unísono o a la octava): tiñe, no compite */
  double: -13,
  echo: -15,
  noise: -16,
}

/**
 * objetivos propios de algunos estilos: en el techno el bombo va por encima del riff y el bajo a su altura;
 * en el house mandan bombo y bajo; en ERA los acordes de Rhodes son protagonistas (sus2 abiertos), no relleno
 */
const TARGET_OVERRIDES: Record<string, Partial<Record<MixRole, number>>> = {
  minimal: { drums: 1, bass: 0 },
  house: { drums: -1, bass: -2 },
  era: { drums: -2, counter: -4 },
  dark: { drums: -2 },
}

/** sonoridad objetivo de un rol en un generador (LU respecto al tema) */
export function targetFor(generator: string, role: MixRole): number {
  return TARGET_OVERRIDES[generator]?.[role] ?? ROLE_TARGET[role]
}

const DEFAULT_ROLE: Record<string, MixRole> = {
  ch6: 'drums',
  fm1: 'bass',
  fm4: 'lead',
  fm2: 'harmony',
  fm3: 'harmony',
  fm5: 'harmony',
  noise: 'noise',
  sq1: 'color',
  sq2: 'color',
  sq3: 'color',
}

/** roles que cambian respecto a la convención, por generador (estilo o pieza) */
const ROLE_OVERRIDES: Record<string, Record<string, MixRole>> = {
  cosmic: { sq2: 'echo', sq3: 'counter' },
  minimal: { sq2: 'echo' },
  dark: { sq2: 'echo', sq3: 'harmony' },
  era: { fm2: 'counter', sq1: 'double', sq2: 'echo', sq3: 'harmony' },
  adventure: { sq1: 'double' },
  boss: { sq1: 'double' },
  house: { sq1: 'double' },
  fusion: { fm5: 'counter', sq1: 'double', sq3: 'echo' },
  swing: { fm5: 'counter', sq1: 'double', sq3: 'echo' },
  storm: { ch6: 'perc', fm2: 'counter', fm5: 'color', sq2: 'echo', sq3: 'counter' },
  fanfare: { ch6: 'perc', fm2: 'counter', sq1: 'double', sq2: 'harmony' },
  maestoso: { ch6: 'perc', sq2: 'double', sq3: 'counter' },
  bourree: { ch6: 'perc', fm5: 'double' },
  gigue: { ch6: 'perc', fm5: 'counter' },
  sarabande: { ch6: 'perc', sq1: 'counter' },
  agitato: { ch6: 'drums', sq1: 'double', sq2: 'echo' },
}

export function roleOf(generator: string, track: Track): MixRole {
  return ROLE_OVERRIDES[generator]?.[track.id] ?? DEFAULT_ROLE[track.id] ?? 'color'
}

/** nombre del instrumento de una pista (las variantes de un estilo cambian de instrumento en la misma pista) */
export function instName(song: Song, t: Track): string {
  if (t.kind === 'fm') return song.fmBank[t.inst]?.name ?? 'FM'
  if (t.kind === 'psg') return song.psgBank[t.inst]?.name ?? 'PSG'
  return t.kind === 'dac' ? 'PCM' : 'RUIDO'
}

/** clave de la tabla: pista + instrumento (con la pista sola como respaldo) */
export const trimKey = (song: Song, t: Track): string => `${t.id}:${instName(song, t)}`

/** instrumento que lleva el tema (fm4): una trompa o una campana dejan todo lo demás relativamente más fuerte */
export function leadName(song: Song): string {
  const t = song.tracks.find((x) => x.id === 'fm4')
  return t ? instName(song, t) : ''
}

/**
 * dB que hay que mover cada pista de un tema de `generator` según la tabla medida. Se busca de lo más
 * concreto a lo más general: pista e instrumento con ese tema ("fm1:TUBA@TROMPA"), pista e instrumento, pista.
 */
export function trimFor(generator: string, song: Song, t: Track): number {
  const table = MIX_TRIMS[generator]
  if (!table) return 0
  const key = trimKey(song, t)
  return table[`${key}@${leadName(song)}`] ?? table[key] ?? table[t.id] ?? 0
}

/** aplica la mezcla medida a un tema recién generado (cambia `song`) */
export function applyMix(song: Song, generator: string): void {
  for (const t of song.tracks) {
    const db = trimFor(generator, song, t)
    if (!db) continue
    t.vol = Math.max(1, Math.min(100, Math.round(t.vol * Math.pow(10, db / 20))))
  }
}
