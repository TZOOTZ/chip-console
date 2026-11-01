// ── Teoría musical: escalas, acordes, nombres de nota ───────────────────────

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

export const isBlackKey = (midi: number): boolean => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)

export const noteName = (midi: number, flats = false): string => {
  const n = ((midi % 12) + 12) % 12
  return `${(flats ? FLAT_NAMES : NOTE_NAMES)[n]}${Math.floor(midi / 12) - 1}`
}
export const pitchClassName = (pc: number, flats = false): string =>
  (flats ? FLAT_NAMES : NOTE_NAMES)[((pc % 12) + 12) % 12]

export type ScaleId =
  | 'minor'
  | 'major'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'phrygianDominant'
  | 'pentMinor'
  | 'pentMajor'
  | 'blues'
  | 'chromatic'

export interface ScaleDef {
  id: ScaleId
  name: string
  steps: number[]
}

export const SCALES: ScaleDef[] = [
  { id: 'minor', name: 'Menor natural', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'major', name: 'Mayor', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dórico', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Frigio', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lidio', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolidio', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrio', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'harmonicMinor', name: 'Menor armónica', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodicMinor', name: 'Menor melódica', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'phrygianDominant', name: 'Frigio dominante', steps: [0, 1, 4, 5, 7, 8, 10] },
  { id: 'pentMinor', name: 'Pentatónica menor', steps: [0, 3, 5, 7, 10] },
  { id: 'pentMajor', name: 'Pentatónica mayor', steps: [0, 2, 4, 7, 9] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'chromatic', name: 'Cromática', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
]

export const scaleById = (id: ScaleId): ScaleDef => SCALES.find((s) => s.id === id) ?? SCALES[0]

/** ¿la nota pertenece a la escala (tónica `root`)? */
export function inScale(midi: number, root: number, scale: ScaleId): boolean {
  const pc = (((midi - root) % 12) + 12) % 12
  return scaleById(scale).steps.includes(pc)
}

/** Ajusta una nota a la escala (la más cercana, prefiriendo hacia abajo en empate). */
export function snapToScale(midi: number, root: number, scale: ScaleId): number {
  if (inScale(midi, root, scale)) return midi
  for (let d = 1; d <= 6; d++) {
    if (inScale(midi - d, root, scale)) return midi - d
    if (inScale(midi + d, root, scale)) return midi + d
  }
  return midi
}

/** Nota de la escala por grado (0 = tónica, admite negativos y > longitud). */
export function scaleDegreeToMidi(degree: number, root: number, scale: ScaleId, baseOctaveMidi: number): number {
  const steps = scaleById(scale).steps
  const len = steps.length
  const oct = Math.floor(degree / len)
  const idx = ((degree % len) + len) % len
  return baseOctaveMidi + root + steps[idx] + oct * 12
}

// ── acordes ─────────────────────────────────────────────────────────────────
export type ChordType =
  | 'maj'
  | 'min'
  | 'sus2'
  | 'sus4'
  | 'dim'
  | 'aug'
  | 'maj7'
  | 'min7'
  | 'dom7'
  | 'min9'
  | 'add9'
  | 'maj9'
  | 'power'
  | 'm7b5'
  | 'dim7'

export interface ChordDef {
  id: ChordType
  label: string
  intervals: number[]
}

export const CHORDS: ChordDef[] = [
  { id: 'maj', label: '', intervals: [0, 4, 7] },
  { id: 'min', label: 'm', intervals: [0, 3, 7] },
  { id: 'sus2', label: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', label: 'sus4', intervals: [0, 5, 7] },
  { id: 'dim', label: '°', intervals: [0, 3, 6] },
  { id: 'aug', label: '+', intervals: [0, 4, 8] },
  { id: 'maj7', label: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'min7', label: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'dom7', label: '7', intervals: [0, 4, 7, 10] },
  { id: 'min9', label: 'm9', intervals: [0, 3, 7, 10, 14] },
  { id: 'add9', label: 'add9', intervals: [0, 4, 7, 14] },
  { id: 'maj9', label: 'maj9', intervals: [0, 4, 7, 11, 14] },
  { id: 'power', label: '5', intervals: [0, 7, 12] },
  { id: 'm7b5', label: 'm7b5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', label: '°7', intervals: [0, 3, 6, 9] },
]

export const chordById = (id: ChordType): ChordDef => CHORDS.find((c) => c.id === id) ?? CHORDS[0]

export function chordNotes(rootMidi: number, type: ChordType, inversion = 0): number[] {
  const iv = chordById(type).intervals.map((i) => rootMidi + i)
  for (let k = 0; k < inversion; k++) {
    const n = iv.shift()
    if (n !== undefined) iv.push(n + 12)
  }
  return iv
}

/** acorde diatónico por grado (0..6) de la escala, con triada o séptima */
export function diatonicChord(
  degree: number,
  root: number,
  scale: ScaleId,
  baseMidi: number,
  seventh = false,
): { root: number; notes: number[]; type: ChordType } {
  const steps = scaleById(scale).steps
  if (steps.length < 7) {
    // pentatónicas/blues: usa la escala menor/mayor natural más cercana
    return diatonicChord(degree, root, steps.includes(3) ? 'minor' : 'major', baseMidi, seventh)
  }
  const n = (k: number) => scaleDegreeToMidi(degree + k, root, scale, baseMidi)
  const r = n(0)
  const third = n(2) - r
  const fifth = n(4) - r
  const sev = n(6) - r
  let type: ChordType = 'maj'
  if (third === 3 && fifth === 7) type = seventh ? (sev === 10 ? 'min7' : 'maj7') : 'min'
  else if (third === 4 && fifth === 7) type = seventh ? (sev === 10 ? 'dom7' : 'maj7') : 'maj'
  else if (third === 3 && fifth === 6) type = seventh ? (sev === 10 ? 'm7b5' : 'dim7') : 'dim'
  else if (third === 4 && fifth === 8) type = 'aug'
  return { root: r, notes: chordNotes(r, type), type }
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
