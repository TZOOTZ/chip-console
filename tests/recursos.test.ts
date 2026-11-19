import { describe, expect, it } from 'vitest'
import { renderSong } from '../src/export/render'
import { songFromHash, songToHash } from '../src/export/share'
import { applyFigure, scalePcs, type FigureId } from '../src/music/figuras'
import { PIECES, PIECE_THEMES, generatePiece, parseChords, parseLine, pcsOf, realize, type PieceId, type PieceMode } from '../src/music/piezas'
import { FM_PRESETS, createEmptySong } from '../src/music/presets'
import { stepsPerBar, type Note, type Song } from '../src/music/song'
import { db, rms } from './helpers'

const SR = 44100
const mod12 = (n: number): number => ((n % 12) + 12) % 12
const fmIndex = (name: string): number => FM_PRESETS.findIndex((p) => p.name === name)

function oneNote(inst: number, note: number, steps: number, vel = 12): Float32Array {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 2
  s.tracks[0].inst = inst
  s.tracks[0].gate = 1
  s.patterns[0].notes.fm1 = [{ step: 0, len: steps, note, vel }]
  return renderSong(s, { sampleRate: SR, tail: 0.3 }).left
}

/** amplitud de los armónicos 1-n en una ventana */
function harmonics(x: Float32Array, at: number, f0: number, n: number, len = 4096): number[] {
  const from = Math.round(at * SR)
  const amp: number[] = []
  for (let k = 1; k <= n; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < len; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1))
      const ph = (2 * Math.PI * k * f0 * i) / SR
      re += x[from + i] * w * Math.cos(ph)
      im += x[from + i] * w * Math.sin(ph)
    }
    amp.push(Math.hypot(re, im))
  }
  return amp
}
/** centro de gravedad del espectro armónico (1 = todo en la fundamental) */
const brightness = (a: number[]): number => a.reduce((s, v, k) => s + v * (k + 1), 0) / a.reduce((s, v) => s + v, 0)
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
const attackMs = (x: Float32Array): number => {
  const env: number[] = []
  for (let i = 0; i + 441 <= Math.min(x.length, SR); i += 220) env.push(rms(x, i, i + 441))
  const mx = Math.max(...env)
  return env.findIndex((e) => e >= 0.9 * mx) * 5
}

describe('metales, clave y oboe', () => {
  it('van al final del banco, detrás del pararrayos', () => {
    expect(FM_PRESETS.slice(37).map((p) => p.name)).toEqual(['TROMPETA', 'TROMPA', 'TUBA', 'CLAVE', 'OBOE'])
    expect(fmIndex('PARARRAYOS')).toBe(36)
  })

  it('la trompeta ataca como un metal: el brillo florece en el ataque y crece con la fuerza', () => {
    const i = fmIndex('TROMPETA')
    const f0 = midiHz(72)
    const x = oneNote(i, 72, 8, 11)
    const a = attackMs(x)
    expect(a).toBeGreaterThanOrEqual(15)
    expect(a).toBeLessThanOrEqual(60)
    expect(brightness(harmonics(x, 0.3, f0, 8))).toBeGreaterThan(brightness(harmonics(x, 0.004, f0, 8, 1024)) * 1.08)
    const b = [6, 10, 15].map((v) => brightness(harmonics(oneNote(i, 72, 8, v), 0.3, f0, 8)))
    expect(b[0]).toBeLessThan(b[1])
    expect(b[1]).toBeLessThan(b[2])
  })

  it('la trompa es más redonda que la trompeta y la tuba tiene fundamental', () => {
    const f0 = midiHz(65)
    const horn = brightness(harmonics(oneNote(fmIndex('TROMPA'), 65, 8), 0.3, f0, 8))
    const trumpet = brightness(harmonics(oneNote(fmIndex('TROMPETA'), 65, 8), 0.3, f0, 8))
    expect(horn).toBeLessThan(trumpet - 0.4)
    const tuba = harmonics(oneNote(fmIndex('TUBA'), 41, 8), 0.3, midiHz(41), 4)
    expect(tuba[0]).toBe(Math.max(...tuba))
  })

  it('el clave pulsa al instante y se apaga aunque la tecla siga abajo', () => {
    const x = oneNote(fmIndex('CLAVE'), 60, 16)
    expect(attackMs(x)).toBeLessThanOrEqual(10)
    expect(db(rms(x, Math.round(1.4 * SR), Math.round(1.5 * SR)) / rms(x, 0, Math.round(0.05 * SR)))).toBeLessThan(-12)
    // muchos armónicos: el décimo no ha desaparecido
    const h = harmonics(x, 0.05, midiHz(60), 10)
    expect(db(h[9] / Math.max(...h))).toBeGreaterThan(-35)
  })

  it('el oboe es nasal: los armónicos 2-4 pesan tanto como la fundamental', () => {
    const h = harmonics(oneNote(fmIndex('OBOE'), 69, 8), 0.3, midiHz(69), 6)
    expect(Math.max(h[1], h[2], h[3])).toBeGreaterThan(h[0] * 0.6)
  })
})

// ── el material escrito ─────────────────────────────────────────────────────
interface Theme {
  name: string
  minor: boolean
  mel?: string
  chords?: string
  melA?: string
  chordsA?: string
  melB?: string
  chordsB?: string
}
const spanOf = (piece: PieceId): number => (piece === 'maestoso' || piece === 'sarabande' ? 1 : 2)

describe('piezas: el material escrito', () => {
  for (const [piece, list] of Object.entries(PIECE_THEMES) as [PieceId, Theme[]][]) {
    const info = PIECES.find((p) => p.id === piece)!
    const spb = info.beats * 4
    for (const t of list) {
      it(`${info.name} · ${t.name}: compases completos y, en cada parte fuerte, una nota del acorde`, () => {
        const pairs: [string, string][] = t.mel && t.chords ? [[t.mel, t.chords]] : [[t.melA ?? '', t.chordsA ?? ''], [t.melB ?? '', t.chordsB ?? '']]
        for (const [mel, ch] of pairs) {
          const line = parseLine(mel, spb)
          const chords = parseChords(ch, t.minor)
          const span = spb / spanOf(piece)
          const end = line.reduce((a, n) => Math.max(a, n.step + n.len), 0)
          expect(chords.length * span).toBe(end)
          const notes = realize(line, (s) => chords[Math.floor(s / span)], 60, t.minor)
          // en el agitato las escalas rápidas del último compás pasan por encima de la mitad del compás
          const strong = (s: number): boolean => (piece === 'agitato' ? s % spb === 0 : s % span === 0)
          for (const n of notes.filter((x) => strong(x.step))) expect(pcsOf(chords[Math.floor(n.step / span)])).toContain(mod12(n.note - 60))
        }
      })
    }
  }

  it('en menor la sensible sube sobre la dominante, y la sexta también cuando sube hacia ella', () => {
    const chords = parseChords('V V', true)
    const notes = realize(parseLine('4.2 5.2 6.2 7.2 6.2 4.2 1.4', 16), (s) => chords[Math.floor(s / 8)], 57, true)
    expect(notes.map((n) => n.note)).toEqual([64, 66, 68, 69, 68, 64, 59])
  })
})

// ── las piezas generadas ────────────────────────────────────────────────────
const MODES: PieceMode[] = ['auto', 'major', 'minor']

describe('piezas: lo que sale', () => {
  for (const p of PIECES) {
    it(`${p.name}: compás, modo, notas dentro del patrón, enlace corto y de ida y vuelta`, () => {
      for (const mode of MODES)
        for (const seed of [1, 2, 3]) {
          const s = generatePiece({ piece: p.id, seed, key: (seed * 5) % 12, mode })
          expect(s.beatsPerBar).toBe(p.beats)
          if (mode !== 'auto') expect(s.scale).toBe(mode)
          expect(s.bpm).toBeGreaterThanOrEqual(p.bpm[0])
          expect(s.bpm).toBeLessThanOrEqual(p.bpm[1])
          for (const pt of s.patterns)
            for (const [tid, arr] of Object.entries(pt.notes))
              for (const n of arr) {
                expect(n.step + n.len, `${tid} ${pt.name}`).toBeLessThanOrEqual(pt.bars * stepsPerBar(s))
                expect(n.vel).toBeGreaterThanOrEqual(1)
              }
          const hash = songToHash(s)
          expect(hash.length).toBeLessThan(3000)
          expect(songFromHash(hash).patterns.map((x) => x.notes)).toEqual(s.patterns.map((x) => x.notes))
        }
    })
  }

  it('la misma semilla da la misma pieza', () => {
    for (const p of PIECES) expect(songToHash(generatePiece({ piece: p.id, seed: 9, key: 2 }))).toBe(songToHash(generatePiece({ piece: p.id, seed: 9, key: 2 })))
  })

  it('el bajo de las danzas y del maestoso no hace quintas ni octavas paralelas con la melodía', () => {
    for (const piece of ['maestoso', 'bourree', 'gigue', 'sarabande'] as PieceId[])
      for (const mode of MODES)
        for (const seed of [1, 2, 3, 4, 5, 6]) {
          const s = generatePiece({ piece, seed, key: seed % 12, mode })
          for (const pt of s.patterns) {
            const mel = pt.notes.fm4 ?? []
            const bass = pt.notes.fm1 ?? []
            const at = (st: number): number | null => mel.find((n) => n.step <= st && st < n.step + n.len)?.note ?? null
            for (let i = 1; i < bass.length; i++) {
              const [a, b] = [bass[i - 1], bass[i]]
              const [ta, tb] = [at(a.step), at(b.step)]
              if (ta === null || tb === null || ta === tb || a.note === b.note) continue
              const ia = mod12(ta - a.note)
              const ib = mod12(tb - b.note)
              const similar = Math.sign(tb - ta) === Math.sign(b.note - a.note)
              expect(similar && ia === ib && (ib === 0 || ib === 7), `${piece} ${mode} ${seed} ${pt.name} paso ${b.step}`).toBe(false)
            }
          }
        }
  })

  it('la fanfarria suena una vez: cuatro compases, acaba en la tónica con plato y no vuelve a empezar', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = generatePiece({ piece: 'fanfare', seed, key: 7 })
      expect(s.loopStart).toBe(-1)
      expect(s.patterns).toHaveLength(1)
      expect(s.patterns[0].bars).toBe(4)
      const mel = s.patterns[0].notes.fm4
      expect(mod12(mel[mel.length - 1].note - 7)).toBe(0)
      const plato = s.drumKit.findIndex((d) => d.kind === 'crash')
      const last = mel[mel.length - 1].step
      expect(s.patterns[0].notes.ch6.some((n) => n.note === plato && n.step >= 48 && n.step <= last)).toBe(true)
    }
  })

  it('la giga va en 6/8 y entra en imitación: el bajo repite el sujeto una octava abajo', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = generatePiece({ piece: 'gigue', seed, key: 2 })
      expect(stepsPerBar(s)).toBe(12)
      const a = s.patterns[0]
      const subject = a.notes.fm4.filter((n) => n.step < 24)
      const answer = a.notes.fm1.filter((n) => n.step >= 24 && n.step < 48)
      expect(answer.map((n) => [n.step - 24, n.len])).toEqual(subject.map((n) => [n.step, n.len]))
      // misma línea una octava (o una octava y algo, por la sensible) por debajo
      answer.forEach((n, k) => expect(subject[k].note - n.note).toBeGreaterThanOrEqual(11))
    }
  })

  it('la zarabanda carga el segundo tiempo y acaba con un retardo que resuelve bajando', () => {
    for (const seed of [1, 2, 3]) {
      const s = generatePiece({ piece: 'sarabande', seed, key: 4 })
      const b = s.patterns[s.patterns.length - 1]
      // los acordes vuelven a atacar en el segundo tiempo de cada compás
      expect(b.notes.fm2.filter((n) => n.step % 12 === 4).length).toBe(8)
      const mel = b.notes.fm4
      const [x, y] = mel.slice(-2)
      expect(x.note).toBeGreaterThan(y.note)
      expect(x.note - y.note).toBeLessThanOrEqual(2)
      expect(y.step % 12).toBe(4)
    }
  })

  it('las danzas repiten ornamentado: la segunda vuelta trae mordentes', () => {
    for (const piece of ['bourree', 'gigue', 'sarabande'] as PieceId[]) {
      const s = generatePiece({ piece, seed: 3, key: 0 })
      const [a1, a2] = s.patterns
      expect(a2.notes.fm4.length).toBeGreaterThan(a1.notes.fm4.length)
      expect(a2.notes.fm4.some((n) => n.slide)).toBe(true)
    }
  })
})

// ── las figuras ─────────────────────────────────────────────────────────────
/** tema en Do mayor, 4/4, un patrón de `bars` compases con las notas dadas en fm4 */
function songWith(notes: Note[], bars = 4, extra: Record<string, Note[]> = {}): Song {
  const s = createEmptySong()
  s.key = 0
  s.scale = 'major'
  s.patterns[0].bars = bars
  s.patterns[0].notes.fm4 = notes.map((n) => ({ ...n }))
  for (const [k, v] of Object.entries(extra)) s.patterns[0].notes[k] = v.map((n) => ({ ...n }))
  return s
}
const N = (step: number, len: number, note: number, vel = 12): Note => ({ step, len, note, vel })
const run = (s: Song, id: FigureId, sel: number[] = [], track = 'fm4') => applyFigure(s, s.patterns[0].id, track, sel, id)
const notesOf = (s: Song, track = 'fm4'): Note[] => s.patterns[0].notes[track]

describe('figuras', () => {
  const motif = [N(0, 4, 60), N(4, 4, 62), N(8, 8, 64)]

  it('GRADATIO: el motivo sube un grado de la escala por vez y cada vez más fuerte', () => {
    const s = songWith([...motif, N(20, 4, 50)])
    expect(run(s, 'gradatio').ok).toBe(true)
    const n = notesOf(s)
    expect(n.map((x) => x.note)).toEqual([60, 62, 64, 62, 64, 65, 64, 65, 67, 65, 67, 69])
    expect(n[3].vel).toBeLessThan(n[6].vel)
  })

  it('SECUENCIA: el motivo y la voz que suena con él bajan un grado tres veces', () => {
    const s = songWith(motif, 4, { fm2: [N(0, 16, 48)] })
    expect(run(s, 'secuencia').ok).toBe(true)
    expect(notesOf(s).map((x) => x.note)).toEqual([60, 62, 64, 59, 60, 62, 57, 59, 60, 55, 57, 59])
    expect(notesOf(s, 'fm2').map((x) => [x.step, x.note])).toEqual([[0, 48], [16, 47], [32, 45], [48, 43]])
  })

  it('OSTINATO: el motivo llena el patrón y borra lo que había detrás', () => {
    const s = songWith([...motif, N(30, 2, 70)])
    expect(run(s, 'ostinato').ok).toBe(true)
    expect(notesOf(s)).toHaveLength(12)
    expect(notesOf(s).some((x) => x.note === 70)).toBe(false)
  })

  it('ANÁFORA: la cabeza vuelve al empezar cada frase y el resto de la frase se queda', () => {
    const body = Array.from({ length: 8 }, (_, b) => [N(b * 16, 4, 60 + b), N(b * 16 + 8, 8, 72)]).flat()
    const s = songWith(body, 8)
    expect(run(s, 'anafora').ok).toBe(true)
    const n = notesOf(s)
    for (const bar of [2, 4, 6]) expect(n.find((x) => x.step === bar * 16)?.note).toBe(60)
    for (const bar of [1, 3, 5, 7]) expect(n.find((x) => x.step === bar * 16)?.note).toBe(60 + bar)
    expect(n.filter((x) => x.note === 72)).toHaveLength(8)
  })

  it('RETARDO: con preparación se liga la nota de arriba; sin ella, entra como apoyatura y resuelve bajando', () => {
    const s = songWith([N(12, 4, 62), N(16, 8, 60), N(28, 4, 67), N(32, 8, 64)])
    expect(run(s, 'retardo').ok).toBe(true)
    const n = notesOf(s)
    expect(n.find((x) => x.note === 62)).toMatchObject({ step: 12, len: 8 })
    expect(n.find((x) => x.note === 60)).toMatchObject({ step: 20, len: 4, slide: true })
    expect(n.find((x) => x.note === 65)).toMatchObject({ step: 32, len: 4 })
    expect(n.find((x) => x.note === 64)).toMatchObject({ step: 36, len: 4 })
  })

  it('MELISMA: la nota larga gira y corre por grados y llega a la siguiente por grado', () => {
    const s = songWith([N(0, 8, 60), N(8, 4, 67)])
    expect(run(s, 'melisma').ok).toBe(true)
    const n = notesOf(s)
    const runNotes = n.filter((x) => x.step < 8)
    expect(runNotes.reduce((a, x) => a + x.len, 0)).toBe(8)
    const pcs = scalePcs({ key: 0, scale: 'major' })
    for (const x of runNotes) expect(pcs).toContain(mod12(x.note))
    expect(Math.abs(runNotes[runNotes.length - 1].note - 67)).toBeLessThanOrEqual(2)
    expect(runNotes.slice(1).every((x) => x.slide)).toBe(true)
  })

  it('MORDENTE: nota, la de debajo y vuelta, sin volver a atacar', () => {
    const s = songWith([N(0, 4, 64), N(4, 2, 65)])
    expect(run(s, 'mordente').ok).toBe(true)
    expect(notesOf(s).map((x) => [x.step, x.len, x.note, !!x.slide])).toEqual([
      [0, 1, 64, false],
      [1, 1, 62, true],
      [2, 2, 64, true],
      [4, 2, 65, false],
    ])
  })

  it('UNÍSONO: una línea de FM se dobla en un canal libre del PSG', () => {
    const s = songWith(motif)
    const r = run(s, 'unisono')
    expect(r.ok).toBe(true)
    expect(notesOf(s, 'sq1').map((x) => x.note)).toEqual([60, 62, 64])
  })

  it('TRÍADA y CUATRÍADA: acordes de la tonalidad que contienen la nota fuerte, por debajo de la melodía', () => {
    const s = songWith([N(0, 8, 72), N(8, 8, 77), N(16, 8, 74), N(24, 8, 72)])
    expect(run(s, 'triada').ok).toBe(true)
    const voices = ['fm2', 'fm3', 'fm5'].map((t) => notesOf(s, t))
    for (const v of voices) expect(v.length).toBeGreaterThan(0)
    const at = (step: number): number[] => voices.map((v) => v.find((x) => x.step <= step && step < x.step + x.len)!.note)
    // Do: I · Fa: IV (o ii) · Re: V (o ii) · Do: I
    expect(at(0).map(mod12).sort()).toEqual([0, 4, 7])
    expect(at(8).every((n) => n < 77)).toBe(true)
    const pc8 = at(8).map(mod12)
    expect(pc8.every((pc) => [5, 9, 0].includes(pc)) || pc8.every((pc) => [2, 5, 9].includes(pc))).toBe(true)
    const s4 = songWith([N(0, 8, 71)])
    expect(run(s4, 'cuatriada').ok).toBe(true)
    expect(['fm2', 'fm3', 'fm5', 'sq2'].map((t) => notesOf(s4, t)?.[0]?.note).filter((x) => x !== undefined)).toHaveLength(4)
  })

  it('CLUSTER: segundas pegadas de la escala justo por debajo de la melodía', () => {
    const s = songWith([N(0, 8, 72)])
    expect(run(s, 'cluster').ok).toBe(true)
    const notes = ['fm2', 'fm3', 'fm5', 'sq2'].map((t) => notesOf(s, t)?.[0]?.note).filter((x): x is number => x !== undefined)
    expect(notes).toEqual([65, 67, 69, 71])
  })

  it('LEGATO, STACCATO y RUBATO', () => {
    const s = songWith([N(0, 3, 60), N(4, 3, 62), N(8, 4, 64)])
    run(s, 'legato')
    expect(notesOf(s).map((x) => [x.len, !!x.slide])).toEqual([
      [4, false],
      [4, true],
      [4, true],
    ])
    run(s, 'staccato')
    expect(notesOf(s).map((x) => [x.len, !!x.slide])).toEqual([
      [2, false],
      [2, false],
      [2, false],
    ])
    const r = songWith([N(0, 4, 60), N(4, 4, 67), N(8, 4, 64), N(12, 4, 62)])
    expect(run(r, 'rubato').ok).toBe(true)
    expect(notesOf(r).map((x) => [x.step, x.len])).toEqual([
      [0, 4],
      [4, 5],
      [9, 3],
      [12, 4],
    ])
  })

  it('en la batería solo valen ANÁFORA y OSTINATO', () => {
    const s = songWith([], 4, { ch6: [N(0, 1, 0), N(4, 1, 1)] })
    expect(run(s, 'gradatio', [], 'ch6').ok).toBe(false)
    expect(run(s, 'ostinato', [], 'ch6').ok).toBe(true)
    expect(notesOf(s, 'ch6').length).toBe(8)
  })
})
