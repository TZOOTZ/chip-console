// ── Bancos de instrumentos de fábrica ───────────────────────────────────────
import {
  SONG_VERSION,
  defaultTracks,
  type DrumVoice,
  type FmOp,
  type FmPatch,
  type NoiseVoice,
  type PsgInst,
  type Song,
  type Vibrato,
  type PitchEnv,
} from './song'

/** op(mul, tl, ar, d1r, sl, d2r, rr, dt?, rs?, am?) */
const op = (mul: number, tl: number, ar: number, d1r: number, sl: number, d2r: number, rr: number, dt = 0, rs = 0, am = 0): FmOp => ({
  mul,
  dt,
  tl,
  rs,
  ar,
  d1r,
  sl,
  d2r,
  rr,
  am,
})
/** operador mudo (TL 127) */
const off = (): FmOp => op(1, 127, 31, 0, 0, 0, 15)

const fm = (
  name: string,
  alg: number,
  fb: number,
  ops: [FmOp, FmOp, FmOp, FmOp],
  extra: { vib?: Vibrato; pitchEnv?: PitchEnv; ams?: number; pms?: number; velMod?: number } = {},
): FmPatch => ({ name, alg, fb, ops, ams: 0, pms: 0, ...extra })

// El ORDEN del banco es sagrado: los enlaces compartidos guardan el índice del parche y omiten
// el banco cuando coincide con el de fábrica. Se puede añadir al final y, a conciencia, mejorar
// el sonido de un parche (los temas viejos sonarán con la versión nueva); nunca mover ni quitar.
//
// Dos pilas en los bajos nuevos (algoritmo 4): una da el peso —portadora casi senoidal, con el
// índice por debajo de 1 rad para que la fundamental no se anule nunca— y la otra el carácter.
// velMod hace que la velocidad abra el timbre además de subir el volumen.
export const FM_PRESETS: FmPatch[] = [
  // 0 — bajos
  fm('SINE SUB', 7, 0, [op(1, 3, 31, 5, 3, 0, 8), off(), off(), off()]),
  // slap: cuerpo redondo + "pop" a la octava (modulador 4:2) que se apaga en ~80 ms;
  // con key scaling para que en las notas altas el chasquido sea más corto
  fm(
    'SLAP BASS',
    4,
    6,
    [op(1, 41, 31, 13, 4, 0, 9, 0, 1), op(1, 4, 31, 9, 3, 4, 9), op(4, 12, 31, 18, 15, 0, 10, 0, 2), op(2, 5, 31, 15, 12, 0, 10, 0, 2)],
    { velMod: 18 },
  ),
  // growl: peso + una pila 3:1 sostenida y desafinada contra la otra; el grano no se apaga
  fm(
    'GROWL',
    4,
    5,
    [op(1, 42, 31, 6, 2, 0, 8), op(1, 5, 31, 6, 2, 2, 8), op(3, 26, 31, 5, 1, 0, 8, 3, 1), op(1, 8, 31, 6, 2, 2, 8, 7)],
    { velMod: 16 },
  ),
  fm('PLUCK BASS', 2, 3, [
    op(1, 36, 31, 22, 15, 0, 9),
    op(2, 32, 31, 24, 15, 0, 9),
    op(1, 26, 31, 18, 12, 0, 9),
    op(1, 6, 31, 14, 8, 0, 8),
  ]),
  // 4 — teclas
  fm('E-PIANO', 4, 3, [
    op(14, 40, 31, 24, 15, 0, 8),
    op(1, 10, 31, 10, 5, 3, 7, 3),
    op(1, 30, 31, 14, 10, 0, 8),
    op(1, 12, 31, 8, 5, 3, 7, 5),
  ]),
  fm('RHODES', 4, 2, [
    op(1, 34, 31, 16, 12, 0, 8),
    op(1, 8, 31, 7, 4, 2, 7, 2),
    op(7, 46, 31, 22, 15, 0, 9),
    op(1, 12, 31, 8, 5, 2, 7, 5),
  ]),
  fm('DX MALLET', 4, 0, [
    op(4, 28, 31, 18, 15, 0, 9),
    op(1, 8, 31, 12, 15, 0, 9),
    op(10, 40, 31, 24, 15, 0, 10),
    op(2, 16, 31, 14, 15, 0, 10),
  ]),
  fm('BELL', 5, 0, [
    op(7, 34, 31, 8, 15, 0, 6),
    op(1, 8, 31, 5, 15, 0, 6),
    op(3, 16, 31, 7, 15, 0, 6),
    op(5, 24, 31, 9, 15, 0, 6),
  ]),
  // 8 — leads
  fm(
    'SAW LEAD',
    7,
    0,
    [op(1, 10, 31, 0, 0, 0, 9), op(2, 18, 31, 0, 0, 0, 9, 1), op(3, 23, 31, 0, 0, 0, 9), op(4, 26, 31, 0, 0, 0, 9)],
    { vib: { delay: 14, rate: 5.5, depth: 18 } },
  ),
  fm(
    'SQUARE LEAD',
    7,
    0,
    [op(1, 4, 31, 0, 0, 0, 9), op(3, 17, 31, 0, 0, 0, 9), op(5, 23, 31, 0, 0, 0, 9), op(7, 27, 31, 0, 0, 0, 9)],
    { vib: { delay: 14, rate: 5.5, depth: 18 } },
  ),
  fm('BRASS', 4, 4, [
    op(1, 22, 20, 6, 6, 0, 7),
    op(1, 10, 21, 5, 3, 0, 7, 1),
    op(1, 26, 18, 6, 8, 0, 7),
    op(1, 12, 20, 5, 3, 0, 7, 5),
  ]),
  fm(
    'FLUTE',
    4,
    5,
    [op(1, 38, 24, 3, 3, 0, 8), op(1, 3, 22, 3, 2, 0, 8), off(), off()],
    { vib: { delay: 18, rate: 5, depth: 16 } },
  ),
  // 12 — pads
  fm('STRINGS', 5, 4, [
    op(1, 38, 14, 0, 0, 0, 6),
    op(1, 14, 12, 0, 0, 0, 5, 2),
    op(2, 20, 13, 0, 0, 0, 5, 5),
    op(1, 16, 12, 0, 0, 0, 5, 6),
  ]),
  fm('CHOIR', 5, 2, [
    op(2, 36, 16, 0, 0, 0, 6),
    op(1, 12, 14, 0, 0, 0, 6, 1),
    op(1, 20, 15, 0, 0, 0, 6, 5),
    op(3, 26, 15, 0, 0, 0, 6),
  ]),
  // 14 — percusión FM y órgano
  fm(
    'FM KICK',
    0,
    7,
    [op(1, 26, 31, 31, 15, 0, 15), op(1, 34, 31, 24, 15, 0, 15), op(1, 40, 31, 28, 15, 0, 15), op(1, 2, 31, 13, 15, 0, 14)],
    { pitchEnv: { semis: 30, frames: 5 } },
  ),
  fm('ORGAN', 7, 0, [op(1, 9, 31, 0, 0, 0, 12), op(2, 13, 31, 0, 0, 0, 12), op(4, 19, 31, 0, 0, 0, 12), op(0, 15, 31, 0, 0, 0, 12)]),
  // ── a partir de aquí solo se AÑADE: los enlaces compartidos antiguos dependen del orden ──
  // 16 — disco espacial
  fm(
    'SEQ BASS',
    4,
    5,
    [
      op(1, 22, 31, 17, 10, 0, 9), // el índice de modulación cae rápido: "filtro" de secuenciador
      op(1, 6, 31, 8, 3, 3, 10),
      op(2, 34, 31, 19, 15, 0, 9),
      op(1, 12, 31, 9, 4, 3, 10, 2),
    ],
    { velMod: 12 }, // los acentos abren el "filtro"
  ),
  fm(
    'SOLINA',
    5,
    5,
    [op(1, 36, 18, 0, 0, 0, 6), op(1, 11, 15, 0, 0, 0, 6, 3), op(1, 22, 15, 0, 0, 0, 6, 7), op(2, 21, 14, 0, 0, 0, 6, 1)],
    { vib: { delay: 0, rate: 5.8, depth: 6 } },
  ),
  fm(
    'COSMIC LEAD',
    4,
    5,
    [op(1, 34, 31, 0, 0, 0, 9), op(1, 7, 26, 0, 0, 0, 9), op(3, 40, 31, 12, 8, 0, 9), op(1, 20, 25, 0, 0, 0, 9, 3)],
    { vib: { delay: 18, rate: 5.6, depth: 20 }, velMod: 10 },
  ),
  // 19 — techno
  fm('TECHNO BELL', 4, 2, [
    op(7, 27, 31, 15, 15, 0, 7), // relación 7:2 → parciales inarmónicos, timbre de campana
    op(2, 8, 31, 14, 15, 0, 7),
    op(5, 33, 31, 16, 15, 0, 7),
    op(1, 11, 31, 13, 15, 0, 7, 3),
  ]),
  fm('STAB', 4, 5, [
    op(1, 24, 31, 13, 9, 0, 10),
    op(1, 6, 31, 13, 13, 6, 10),
    op(2, 31, 31, 16, 12, 0, 10),
    op(1, 10, 31, 14, 14, 6, 10, 3),
  ]),
  fm('ACID', 2, 6, [
    op(1, 21, 31, 16, 10, 0, 10),
    op(5, 44, 31, 20, 15, 0, 10),
    op(3, 34, 31, 17, 13, 0, 10),
    op(1, 5, 31, 9, 5, 3, 11),
  ]),
  // 22 — oscuros
  fm('REESE BASS', 4, 6, [
    op(1, 35, 31, 0, 0, 0, 8),
    op(1, 8, 31, 0, 0, 0, 9, 3),
    op(1, 35, 31, 0, 0, 0, 8, 1),
    op(1, 13, 31, 0, 0, 0, 9, 7),
  ]),
  fm(
    'DARK PAD',
    5,
    3,
    [op(1, 37, 13, 0, 0, 0, 5), op(1, 6, 13, 0, 0, 0, 4, 2, 0, 1), op(1, 15, 13, 0, 0, 0, 4, 6, 0, 1), op(3, 24, 12, 0, 0, 0, 4)],
    { ams: 2 }, // trémolo con el LFO del chip (solo si la canción lo enciende)
  ),
  fm('THEREMIN', 4, 2, [op(1, 44, 31, 0, 0, 0, 8), op(1, 5, 16, 0, 0, 0, 6), off(), off()], { vib: { delay: 6, rate: 6.3, depth: 34 } }),
  // 25 — jazz: viento, cuerda pulsada, contrabajo y láminas
  // sax: dos pilas casi sostenidas; el aire del ataque es la subida lenta (AR 22-25) y la realimentación del
  // OP1 da el grano de lengüeta. La velocidad abre el timbre (velMod) como el soplo al fuerte
  fm(
    'SAX',
    4,
    6,
    [op(1, 30, 22, 0, 0, 0, 9), op(1, 6, 25, 3, 2, 0, 9, 0, 1), op(2, 38, 20, 0, 0, 0, 9, 3), op(1, 14, 24, 3, 2, 0, 9, 5)],
    { vib: { delay: 12, rate: 5.3, depth: 16 }, velMod: 12 },
  ),
  // guitarra de jazz: ataque de púa muy corto (modulador que cae en ~60 ms) y cuerpo hueco a la octava
  fm(
    'JAZZ GUITAR',
    4,
    3,
    [op(1, 34, 31, 18, 15, 0, 9), op(1, 3, 31, 10, 5, 3, 8), op(3, 30, 31, 22, 15, 0, 10), op(2, 14, 31, 12, 7, 3, 8, 0, 1)],
    { velMod: 14 },
  ),
  // contrabajo: fundamental casi senoidal que sostiene, y un golpe de dedo (3:1) que se apaga enseguida
  fm(
    'WALK BASS',
    4,
    4,
    [op(1, 40, 31, 12, 4, 0, 9, 0, 1), op(1, 5, 31, 6, 4, 2, 9, 0, 1), op(3, 26, 31, 24, 15, 0, 10, 0, 2), op(2, 14, 31, 14, 10, 0, 10, 0, 2)],
    { velMod: 14 },
  ),
  // vibráfono: fundamental larga y el 4º parcial de la lámina, que suena un instante; trémolo de motor con el LFO
  fm(
    'VIBES',
    4,
    0,
    [op(1, 44, 31, 10, 6, 0, 8), op(1, 2, 31, 6, 8, 1, 6, 0, 0, 1), op(1, 52, 31, 20, 15, 0, 10), op(4, 24, 31, 18, 15, 0, 9, 0, 0, 1)],
    { ams: 2 },
  ),
  // 29 — cuerdas de arco. Todas en algoritmo 4: una pila con realimentación da la diente de sierra de la
  // cuerda frotada y la otra, a la octava, el color de la caja. El arco es la subida (AR 19-24); el
  // vibrato llega tarde, como en un violinista. La velocidad es la presión del arco (velMod)
  fm(
    'VIOLIN',
    4,
    6,
    [op(1, 24, 19, 3, 4, 0, 8), op(1, 6, 17, 0, 0, 0, 8), op(3, 56, 19, 4, 5, 0, 8), op(2, 14, 17, 0, 0, 0, 8, 3)],
    { vib: { delay: 15, rate: 5.8, depth: 18 } },
  ),
  // sección: dos portadoras desafinadas (DT +2 / −2) a 4,5 dB una de otra, para que batan sin anularse
  fm(
    'VIOLINS',
    4,
    6,
    [op(1, 24, 15, 0, 0, 0, 7), op(1, 5, 14, 0, 0, 0, 7, 2), op(1, 36, 15, 0, 0, 0, 7), op(1, 20, 14, 0, 0, 0, 7, 6)],
    { vib: { delay: 0, rate: 5.4, depth: 8 } },
  ),
  // pizzicato: cuerda pulsada que se apaga sola; el golpe de dedo es el modulador 4:1, que dura un instante
  fm(
    'PIZZICATO',
    4,
    3,
    [op(1, 24, 31, 12, 15, 0, 10, 0, 1), op(1, 8, 31, 13, 15, 0, 10, 0, 1), op(4, 36, 31, 14, 15, 0, 12), op(2, 14, 31, 15, 15, 0, 10, 3, 1)],
    { velMod: 14 },
  ),
  // spiccato: arco saltado para los ostinatos en semicorcheas, mordida corta y poco cuerpo sostenido
  fm(
    'SPICCATO',
    4,
    6,
    [op(1, 24, 31, 10, 6, 0, 10), op(1, 7, 29, 13, 8, 6, 11), op(3, 56, 31, 14, 15, 0, 11), op(2, 26, 29, 14, 8, 6, 11, 3)],
    { velMod: 6 },
  ),
  // sul ponticello: arco junto al puente, vidrioso. Los parciales 3 y 5 desafinados mandan sobre la
  // fundamental; con el LFO del chip encendido, además, tiembla
  fm(
    'PONTICELLO',
    4,
    7,
    [op(1, 30, 18, 0, 0, 0, 8), op(1, 4, 17, 0, 0, 0, 8, 0, 0, 1), op(5, 36, 18, 0, 0, 0, 8, 2), op(3, 8, 16, 0, 0, 0, 8, 6, 0, 1)],
    { vib: { delay: 0, rate: 6.5, depth: 10 }, ams: 2 },
  ),
  fm(
    'CELLO',
    4,
    4,
    [op(1, 30, 19, 2, 3, 0, 7), op(1, 5, 18, 0, 0, 0, 7), op(2, 40, 20, 0, 0, 0, 7), op(1, 18, 18, 0, 0, 0, 7, 2)],
    { vib: { delay: 18, rate: 5.2, depth: 14 }, velMod: 10 },
  ),
  // 35 — electricidad. RAYO: cadena con el OP1 a realimentación máxima (casi ruido) y relaciones
  // inarmónicas, que cae cuatro octavas en picado. PARARRAYOS: el zumbido de la carga, un arco
  // sostenido que titubea (vibrato rápido); se toca grave y se sube con GLIDE hasta el rayo
  fm(
    'RAYO',
    0,
    7,
    [op(1, 20, 31, 6, 4, 0, 12), op(11, 24, 31, 10, 6, 0, 12, 3), op(7, 28, 31, 8, 8, 0, 12, 5), op(1, 4, 31, 13, 15, 0, 12)],
    { pitchEnv: { semis: 36, frames: 10 } },
  ),
  fm(
    'PARARRAYOS',
    1,
    7,
    [op(1, 22, 31, 0, 0, 0, 6), op(7, 30, 31, 0, 0, 0, 6, 3), op(1, 26, 31, 0, 0, 0, 6), op(1, 6, 28, 0, 0, 0, 6)],
    { vib: { delay: 0, rate: 13, depth: 30 } },
  ),
]

const psg = (name: string, vol: number, a: number, d: number, s: number, r: number, extra: Partial<PsgInst> = {}): PsgInst => ({
  name,
  vol,
  a,
  d,
  s,
  r,
  detune: 0,
  ...extra,
})

export const PSG_PRESETS: PsgInst[] = [
  psg('LEAD', 13, 0, 0, 0, 3, { vib: { delay: 10, rate: 5.5, depth: 25 } }),
  psg('PLUCK', 14, 0, 12, 15, 2),
  psg('PAD', 11, 8, 0, 0, 12),
  psg('STAB', 14, 0, 5, 8, 2),
  psg('ARP', 12, 0, 8, 6, 1),
  psg('BASS', 15, 0, 0, 1, 3),
  psg('ECHO', 8, 0, 6, 4, 4),
  psg('SWELL', 14, 18, 0, 0, 8),
  // ── solo se añade al final (ver nota en el banco FM) ──
  psg('LASER', 13, 0, 16, 15, 2, { pitchEnv: { semis: 30, frames: 14 } }),
  psg('BLIP', 13, 0, 3, 15, 1),
  psg('TWINKLE', 12, 0, 10, 12, 4, { pitchEnv: { semis: 12, frames: 2 }, vib: { delay: 6, rate: 7, depth: 12 } }),
  // el mismo pluck al máximo que da el chip: con el PSG calibrado a la consola, los arpegios lo necesitan
  psg('PLUCK HI', 15, 0, 12, 15, 2),
  // chispa: tres octavas que caen en tres frames y se apagan; un chasquido eléctrico, no una nota
  psg('CHISPA', 15, 0, 4, 15, 0, { pitchEnv: { semis: 36, frames: 3 } }),
]

const nz = (name: string, white: boolean, rate: number, vol: number, d: number, s: number, r = 0): NoiseVoice => ({
  name,
  white,
  rate,
  vol,
  a: 0,
  d,
  s,
  r,
})

export const NOISE_KIT: NoiseVoice[] = [
  nz('HAT', true, 0, 14, 3, 15),
  nz('OPEN', true, 0, 13, 14, 15, 2),
  nz('SNARE', true, 1, 14, 7, 15),
  nz('LO SNARE', true, 2, 14, 10, 15),
  nz('BUZZ', false, 0, 12, 6, 15),
  nz('RUMBLE', false, 2, 14, 20, 15),
]

const drum = (name: string, kind: DrumVoice['kind'], pitch: number, decay: number, tone: number, gain = 0.9): DrumVoice => ({
  name,
  kind,
  pitch,
  decay,
  tone,
  gain,
})

export const DRUM_KIT: DrumVoice[] = [
  drum('KICK', 'kick', 0.42, 0.5, 0.45, 0.95),
  drum('SNARE', 'snare', 0.5, 0.45, 0.55, 0.9),
  drum('HAT', 'hat', 0.5, 0.2, 0.5, 0.7),
  drum('OPEN HAT', 'ohat', 0.5, 0.5, 0.5, 0.7),
  drum('CLAP', 'clap', 0.5, 0.5, 0.5, 0.85),
  drum('TOM LO', 'tom', 0.28, 0.55, 0.5, 0.9),
  drum('TOM HI', 'tom', 0.62, 0.5, 0.5, 0.9),
  drum('RIM', 'rim', 0.5, 0.3, 0.5, 0.8),
]

const cloneJson = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Canción vacía con los bancos de fábrica y un patrón A de 4 compases. */
export function createEmptySong(): Song {
  const tracks = defaultTracks()
  const notes: Record<string, never[]> = {}
  for (const t of tracks) notes[t.id] = []
  return {
    version: SONG_VERSION,
    title: 'SIN TÍTULO',
    author: '',
    bpm: 113,
    swing: 0,
    swingGrid: 2,
    beatsPerBar: 4,
    key: 0,
    scale: 'minor',
    dacRate: 14700,
    lfo: 0,
    fmBank: cloneJson(FM_PRESETS),
    psgBank: cloneJson(PSG_PRESETS),
    noiseKit: cloneJson(NOISE_KIT),
    drumKit: cloneJson(DRUM_KIT),
    tracks,
    patterns: [{ id: 'p1', name: 'A', bars: 4, notes }],
    order: ['p1'],
    loopStart: 0,
  }
}
