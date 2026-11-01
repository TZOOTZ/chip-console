// ── Estilos electrónicos: COSMIC DISCO · TECHNO MINIMAL · DARK ───────────────
import { deflateSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { renderDrum } from '../src/engine/drums'
import { packSong, songFromHash, songToHash } from '../src/export/share'
import { COSMIC_IDEAS, COSMIC_PROGS } from '../src/music/cosmic'
import { STYLES, generateSong, generateTrackNotes, type StyleId } from '../src/music/generator'
import { createEmptySong } from '../src/music/presets'
import { patternSteps, timpPitch, type Pattern, type Song } from '../src/music/song'
import { scaleById } from '../src/music/theory'
import { peakFreq } from './helpers'

const ELECTRO: StyleId[] = ['cosmic', 'minimal', 'dark']
const DR = { KICK: 0, SNARE: 1, HAT: 2, OPEN: 3, CLAP: 4 }
const PADS = ['fm2', 'fm3', 'fm5']

const pat = (song: Song, name: string): Pattern => song.patterns.find((p) => p.name === name)!
const pitched = (song: Song) => song.tracks.filter((t) => t.kind === 'fm' || t.kind === 'psg')
const relPc = (song: Song, note: number): number => (((note - song.key) % 12) + 12) % 12
const drumSteps = (p: Pattern, drum: number, bar: number): number[] =>
  (p.notes.ch6 ?? []).filter((n) => n.note === drum && Math.floor(n.step / 16) === bar).map((n) => n.step % 16)

describe('estilos electrónicos', () => {
  it('están los primeros en la lista y con un tempo propio de cada género', () => {
    expect(STYLES.slice(0, 3).map((s) => s.id)).toEqual(ELECTRO)
    const bpm = Object.fromEntries(STYLES.map((s) => [s.id, s.bpm]))
    expect(bpm.cosmic[0]).toBeGreaterThanOrEqual(110)
    expect(bpm.cosmic[1]).toBeLessThanOrEqual(128)
    expect(bpm.minimal[0]).toBeGreaterThanOrEqual(130)
    expect(bpm.dark[1]).toBeLessThanOrEqual(132)
  })

  for (const style of ELECTRO) {
    it(`${style}: determinista por semilla y distinto entre semillas`, () => {
      const a = generateSong({ style, seed: 5, key: 2 })
      const b = generateSong({ style, seed: 5, key: 2 })
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(generateSong({ style, seed, key: 2 }).patterns[1].notes)))
      expect(variants.size).toBeGreaterThanOrEqual(7)
    })

    it(`${style}: secciones de 4, 8 y 16 compases, tempo automático en rango y tempo fijado`, () => {
      const info = STYLES.find((s) => s.id === style)!
      for (const bars of [4, 8, 16]) {
        for (const seed of [3, 12]) {
          const song = generateSong({ style, seed, key: seed % 12, bars })
          expect(song.bpm).toBeGreaterThanOrEqual(info.bpm[0])
          expect(song.bpm).toBeLessThanOrEqual(info.bpm[1])
          expect(song.patterns.map((p) => p.name)).toEqual(['INTRO', 'A', 'B', 'BRK', 'FINAL', 'OUTRO'])
          expect(song.loopStart).toBe(1)
          for (const p of song.patterns) {
            expect(p.bars).toBe(bars)
            const max = patternSteps(song, p)
            for (const t of song.tracks) {
              for (const n of p.notes[t.id] ?? []) {
                expect(n.step + n.len, `${p.name} ${t.id}`).toBeLessThanOrEqual(max)
                if (t.kind === 'fm' || t.kind === 'psg') {
                  expect(n.note).toBeGreaterThanOrEqual(24)
                  expect(n.note).toBeLessThanOrEqual(108)
                } else expect(n.note).toBeLessThan(t.kind === 'dac' ? song.drumKit.length : song.noiseKit.length)
              }
            }
          }
        }
      }
      expect(generateSong({ style, seed: 1, key: 0, bpm: 101 }).bpm).toBe(101)
    })

    it(`${style}: los acordes van a tres voces reales (una nota por canal FM, nunca dos a la vez)`, () => {
      for (const seed of [2, 9, 31]) {
        const song = generateSong({ style, seed, key: 7 })
        let chordSteps = 0
        for (const p of song.patterns) {
          for (const id of PADS) {
            const steps = (p.notes[id] ?? []).map((n) => n.step)
            expect(new Set(steps).size, `${p.name} ${id}`).toBe(steps.length)
          }
          const at = new Set((p.notes.fm2 ?? []).map((n) => n.step))
          for (const n of p.notes.fm3 ?? []) if (at.has(n.step)) chordSteps++
        }
        expect(chordSteps).toBeGreaterThan(8)
        // las tres voces reparten el estéreo
        expect(PADS.map((id) => song.tracks.find((t) => t.id === id)!.pan).sort()).toEqual(['C', 'L', 'R'])
      }
    })

    it(`${style}: el enlace compartido reconstruye el tema y cabe de sobra en una URL`, () => {
      const song = generateSong({ style, seed: 44, key: 4 })
      const hash = songToHash(song)
      expect(hash.length).toBeLessThan(3000)
      const back = songFromHash(hash)
      expect(back.drumKit).toEqual(song.drumKit)
      expect(back.tracks.map((t) => [t.name, t.inst, t.vol, t.pan, t.gate])).toEqual(song.tracks.map((t) => [t.name, t.inst, t.vol, t.pan, t.gate]))
      expect(back.patterns.map((p) => p.notes)).toEqual(song.patterns.map((p) => p.notes))
      expect(back.lfo).toBe(song.lfo)
    })
  }
})

describe('cosmic disco', () => {
  const natural = scaleById('minor').steps

  it('siempre en menor: la sensible solo sobre la dominante y la segunda rebajada solo en la napolitana', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const song = generateSong({ style: 'cosmic', seed, key: seed % 12 })
      expect(song.scale).toBe('minor')
      for (const p of song.patterns) {
        // lo que suena en cada compás (el eco va tres semicorcheas por detrás de su arpegio)
        const byBar = Array.from({ length: p.bars }, () => new Set<number>())
        for (const t of pitched(song)) {
          if (t.id === 'fm1') continue
          const lag = t.id === 'sq2' ? 3 : 0
          for (const n of p.notes[t.id] ?? []) byBar[Math.floor((n.step - lag) / 16)].add(relPc(song, n.note))
        }
        byBar.forEach((pcs, bar) => {
          const where = `semilla ${seed} ${p.name} compás ${bar + 1}`
          for (const pc of pcs) expect(natural.includes(pc) || pc === 11 || pc === 1, `${where}: ${pc}`).toBe(true)
          // con la sensible nadie toca el séptimo grado natural, y con la napolitana nadie toca la segunda natural
          if (pcs.has(11)) expect(pcs.has(10), where).toBe(false)
          if (pcs.has(1)) expect(pcs.has(2), where).toBe(false)
        })
        // el bajo no toca nunca la sensible: fundamentales, quintas y octavas
        for (const n of p.notes.fm1 ?? []) expect(natural.includes(relPc(song, n.note)) || relPc(song, n.note) === 1, `semilla ${seed} ${p.name} bajo`).toBe(true)
      }
    }
  })

  it('progresiones curadas: arrancan en la tónica y cierran en la dominante o en dominante → tónica', () => {
    expect(COSMIC_PROGS.length).toBeGreaterThanOrEqual(8)
    for (const p of COSMIC_PROGS) {
      expect(p.full, p.name).toHaveLength(8)
      expect(p.short, p.name).toHaveLength(4)
      for (const bars of [p.full, p.short]) {
        expect(bars[0].deg, p.name).toBe(0)
        const end = bars[bars.length - 1]
        const before = bars[bars.length - 2]
        expect(end.deg === 4 || (end.deg === 0 && before.deg === 4), p.name).toBe(true)
        for (const c of bars) {
          // dominante siempre mayor (con sensible); el resto, acordes de la escala menor o la napolitana
          if (c.deg === 4) expect(['maj', 'dom7'], p.name).toContain(c.type)
          if (c.deg === 0) expect(c.type).toBe('min')
        }
      }
    }
    // toda idea melódica: cabeza y cola de un compás, y la cola descansa en un valor largo
    expect(COSMIC_IDEAS.length).toBeGreaterThanOrEqual(12)
    for (const i of COSMIC_IDEAS) {
      for (const half of [i.a, i.b]) expect(half.reduce((m, n) => Math.max(m, n.s + n.l), 0), i.name).toBeLessThanOrEqual(16)
      expect(Math.max(...i.b.map((n) => n.l)), i.name).toBeGreaterThanOrEqual(6)
    }
  })

  it('forma: INTRO · A · B×2 · BRK · FINAL×2 · OUTRO, bombo a negras y palmas en 2 y 4', () => {
    for (const seed of [1, 6, 21, 40]) {
      const song = generateSong({ style: 'cosmic', seed, key: 9 })
      expect(song.order.map((id) => song.patterns.find((p) => p.id === id)!.name)).toEqual(['INTRO', 'A', 'B', 'B', 'BRK', 'FINAL', 'FINAL', 'OUTRO'])
      expect(song.title).toMatch(/^COSMIC \S+ \d{4}$/)
      for (const name of ['A', 'B', 'FINAL']) {
        const p = pat(song, name)
        for (let bar = 0; bar < p.bars; bar++) {
          // las cuatro negras siempre; a mitad de frase, además, una recogida antes de la barra
          const kick = drumSteps(p, DR.KICK, bar)
          expect(kick.filter((s) => s % 4 === 0), `${name} compás ${bar}`).toEqual([0, 4, 8, 12])
          expect(kick.filter((s) => s % 4 !== 0), `${name} compás ${bar}`).toEqual(bar % 8 === 3 ? [15] : [])
        }
        expect(drumSteps(p, DR.CLAP, 0)).toEqual([4, 12])
        // el bajo cae en la fundamental, en el registro grave
        const first = (p.notes.fm1 ?? []).filter((n) => n.step % 16 === 0)
        expect(first.length).toBe(p.bars)
        for (const n of first) expect(n.note).toBeLessThan(50)
        expect(relPc(song, first[0].note)).toBe(0)
      }
      // el eco es el arpegio tres semicorcheas después
      const arp = pat(song, 'A').notes.sq1 ?? []
      const echo = pat(song, 'A').notes.sq2 ?? []
      expect(echo[0].step).toBe(arp[0].step + 3)
      expect(echo[0].note).toBe(arp[0].note)
    }
  })

  it('el tema: entra en B, se expone y se repite en secuencia, y vuelve a dos voces en el FINAL', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const song = generateSong({ style: 'cosmic', seed, key: seed % 12 })
      const lead = pat(song, 'B').notes.fm4 ?? []
      // en A la voz principal solo se asoma al final: la cabeza del tema a un lado y su eco al otro
      const peek = pat(song, 'A').notes.fm4 ?? []
      const bars = pat(song, 'A').bars
      expect(peek.length, `semilla ${seed}`).toBeGreaterThan(0)
      for (const n of peek) {
        expect(n.step, `semilla ${seed}`).toBeGreaterThanOrEqual((bars - 2) * 16)
        expect(n.pan, `semilla ${seed}`).toBe(n.step < (bars - 1) * 16 ? 'L' : 'R')
      }
      const cell = (bar: number) => peek.filter((n) => Math.floor(n.step / 16) === bar).map((n) => [n.step % 16, n.len])
      expect(cell(bars - 1), `semilla ${seed}`).toEqual(cell(bars - 2))
      expect(cell(bars - 1), `semilla ${seed}`).toEqual(lead.filter((n) => n.step < 16).map((n) => [n.step, n.len]))
      // el tema entero va al centro: ninguna nota con panorama propio
      expect(lead.every((n) => n.pan === undefined), `semilla ${seed}`).toBe(true)
      expect(lead.length).toBeGreaterThanOrEqual(16)
      // una sola voz, sin solapes, en el registro del lead
      for (let i = 1; i < lead.length; i++) expect(lead[i].step, `semilla ${seed}`).toBeGreaterThanOrEqual(lead[i - 1].step + lead[i - 1].len)
      for (const n of lead) {
        expect(n.note, `semilla ${seed}`).toBeGreaterThanOrEqual(60)
        expect(n.note, `semilla ${seed}`).toBeLessThanOrEqual(93)
      }
      // secuencia: los compases 3-4 repiten el ritmo de los compases 1-2 sobre los acordes siguientes
      const rhythm = (bar: number) => lead.filter((n) => Math.floor(n.step / 16) === bar).map((n) => [n.step % 16, n.len])
      expect(rhythm(2), `semilla ${seed}`).toEqual(rhythm(0))
      expect(rhythm(3), `semilla ${seed}`).toEqual(rhythm(1))
      // la frase cierra reposando: la última nota es larga y no pasa de la mitad del registro
      expect(lead[lead.length - 1].len).toBeGreaterThanOrEqual(4)
      // mismo tema en B y FINAL
      expect(pat(song, 'FINAL').notes.fm4).toEqual(lead)
      // la segunda voz solo aparece en el FINAL: mismo ritmo, siempre por debajo (terceras y cuartas, o la octava)
      expect(pat(song, 'B').notes.sq3 ?? []).toHaveLength(0)
      const second = pat(song, 'FINAL').notes.sq3 ?? []
      expect(second.map((n) => [n.step, n.len])).toEqual(lead.map((n) => [n.step, n.len]))
      const gaps = second.map((n, i) => lead[i].note - n.note)
      expect(gaps.every((d) => d === 12) || gaps.every((d) => d >= 3 && d <= 6), `semilla ${seed}: ${gaps.join(' ')}`).toBe(true)
    }
  })

  it('el puente canta el arranque del tema a mitad de velocidad y desemboca en la dominante', () => {
    for (const seed of [2, 7, 13, 21, 30]) {
      const song = generateSong({ style: 'cosmic', seed, key: 4 })
      const head = (pat(song, 'B').notes.fm4 ?? []).filter((n) => n.step < 32)
      const brk = pat(song, 'BRK')
      const slow = (brk.notes.fm4 ?? []).filter((n) => n.step < 64)
      expect(slow.map((n) => [n.step, n.len, n.note])).toEqual(head.map((n) => [n.step * 2, n.len * 2, n.note]))
      // sin palmas ni bajo andante: en los dos últimos compases el bajo se planta en la dominante
      expect(drumSteps(brk, DR.CLAP, 0)).toEqual([])
      const bass = brk.notes.fm1 ?? []
      expect(bass.length).toBeGreaterThan(0)
      for (const n of bass) {
        expect(n.step).toBeGreaterThanOrEqual((brk.bars - 2) * 16)
        expect(relPc(song, n.note)).toBe(7)
      }
      // el último compás lleva la sensible en los acordes: es la dominante
      const lastBar = PADS.flatMap((id) => (brk.notes[id] ?? []).filter((n) => n.step + n.len > (brk.bars - 1) * 16)).map((n) => relPc(song, n.note))
      expect(lastBar).toContain(11)
    }
  })

  it('la coda cierra con cadencia perfecta: dominante con redoble de timbal y tónica con el golpe final', () => {
    for (const bars of [4, 8, 16]) {
      for (const seed of [3, 9, 17]) {
        const song = generateSong({ style: 'cosmic', seed, key: 7, bars })
        const p = pat(song, 'OUTRO')
        const last = (bars - 1) * 16
        const at = (id: string, step: number) => (p.notes[id] ?? []).filter((n) => n.step === step)
        expect(at('fm1', last).map((n) => relPc(song, n.note))).toEqual([0])
        expect(at('fm1', last - 16).map((n) => relPc(song, n.note))).toEqual([7])
        expect(at('fm4', last).map((n) => relPc(song, n.note))).toEqual([0])
        const chord = PADS.flatMap((id) => at(id, last)).map((n) => relPc(song, n.note)).sort((x, y) => x - y)
        expect(chord).toEqual([0, 3, 7])
        // timbal de la tónica (6) y plato (7) en el último compás; redoble en el timbal grave (5) justo antes
        expect(at('ch6', last).map((n) => n.note).sort()).toEqual([0, 6, 7])
        expect((p.notes.ch6 ?? []).filter((n) => n.note === 5 && n.step >= last - 8 && n.step < last)).toHaveLength(8)
      }
    }
  })

  it('kit de orquesta: timbales afinados a la tónica y la dominante de cada tonalidad, y plato', () => {
    const pcOf = (hz: number): number => ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12
    for (let key = 0; key < 12; key++) {
      const song = generateSong({ style: 'cosmic', seed: 3, key })
      expect(song.drumKit.map((d) => d.kind)).toEqual(['kick', 'snare', 'hat', 'ohat', 'clap', 'timp', 'timp', 'crash'])
      for (const d of song.drumKit) expect(d.name.length).toBeLessThanOrEqual(12)
      // se mide la nota que de verdad suena en el PCM de cada timbal
      const hz = (i: number): number => peakFreq(renderDrum(song.drumKit[i], 14700), 14700, 50)
      expect(pcOf(hz(6)), `tónica en ${key}`).toBe(key)
      expect(pcOf(hz(5)), `dominante en ${key}`).toBe((key + 7) % 12)
      // el grave es la dominante, una cuarta justa por debajo de la tónica
      expect(Math.round(12 * Math.log2(hz(6) / hz(5)))).toBe(5)
      expect(hz(5)).toBeGreaterThan(75)
      expect(hz(6)).toBeLessThan(215)
    }
    const song = generateSong({ style: 'cosmic', seed: 3, key: 0 })
    expect(packSong(song).dk).toBeDefined()
    // los bancos de instrumentos son los de fábrica: no engordan el enlace
    expect(packSong(song).fm).toBeUndefined()
    expect(packSong(song).psg).toBeUndefined()
    expect(songFromHash(songToHash(song)).drumKit).toEqual(song.drumKit)
  })

  it('nada se repite compás a compás: el bajo y la batería tienen variante, giro de mitad de frase y cierre', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const song = generateSong({ style: 'cosmic', seed, key: seed % 12 })
      const shapes: string[] = []
      for (const name of ['A', 'B', 'FINAL']) {
        const p = pat(song, name)
        const where = `semilla ${seed} ${name}`
        // dibujo del bajo de cada compás, relativo a su primera nota
        const bass = (bar: number): string => {
          const ns = (p.notes.fm1 ?? []).filter((n) => Math.floor(n.step / 16) === bar)
          return ns.map((n) => `${n.step % 16}:${n.len}:${n.note - ns[0].note}`).join(' ')
        }
        // bombo, caja, charles y palmas (sin timbales ni plato, que marcan las entradas)
        const drums = (bar: number): string =>
          (p.notes.ch6 ?? [])
            .filter((n) => Math.floor(n.step / 16) === bar && n.note < 5)
            .map((n) => `${n.step % 16}:${n.note}:${n.vel}`)
            .join(' ')
        const shaker = (bar: number): string => (p.notes.noise ?? []).filter((n) => Math.floor(n.step / 16) === bar).map((n) => n.vel).join(' ')
        const bars = Array.from({ length: p.bars }, (_, b) => b)
        expect(new Set(bars.map(bass)).size, where).toBeGreaterThanOrEqual(3)
        expect(new Set(bars.map(drums)).size, where).toBe(4)
        expect(new Set(bars.map(shaker)).size, where).toBeGreaterThanOrEqual(3)
        // el compás 2 no es el 1, y el 4 (giro) no es ninguno de los dos
        expect(bass(1), where).not.toBe(bass(0))
        expect(bass(3), where).not.toBe(bass(1))
        expect(drums(1), where).not.toBe(drums(0))
        expect(drums(3), where).not.toBe(drums(1))
        // giro: palmas dobladas · cierre de frase: la palmada del 4 deja sitio al redoble de timbal
        expect(drumSteps(p, DR.CLAP, 3), where).toEqual([4, 12, 14])
        expect(drumSteps(p, DR.CLAP, p.bars - 1), where).toEqual([4])
        expect((p.notes.ch6 ?? []).filter((n) => [1, 5, 6].includes(n.note) && n.step >= (p.bars - 1) * 16 + 4).length, where).toBeGreaterThanOrEqual(3)
        // el bajo llega al compás siguiente por su fundamental: la última nota del giro la anticipa
        const turn = (p.notes.fm1 ?? []).filter((n) => Math.floor(n.step / 16) === 3)
        const next = (p.notes.fm1 ?? []).find((n) => n.step === 64)!
        if (turn[turn.length - 1].step % 16 === 15) expect(relPc(song, turn[turn.length - 1].note), where).toBe(relPc(song, next.note))
        shapes.push(bass(0))
      }
      // el final lleva otro dibujo de bajo, siempre en semicorcheas
      expect(shapes[2], `semilla ${seed}`).not.toBe(shapes[0])
      expect(shapes[1], `semilla ${seed}`).toBe(shapes[0])
      // cada sección cierra sus frases con un redoble distinto
      const fill = (name: string): string =>
        (pat(song, name).notes.ch6 ?? [])
          .filter((n) => [1, 5, 6].includes(n.note) && n.step >= 7 * 16 + 4)
          .map((n) => `${n.step % 16}:${n.vel}`)
          .join(' ')
      expect(new Set(['A', 'B', 'FINAL'].map(fill)).size, `semilla ${seed}`).toBe(3)
    }
  })

  it('articulación: el tema liga las notas cortas (con portamento) y ataca las largas y cada compás', () => {
    let slid = 0
    let themes = 0
    for (let seed = 1; seed <= 40; seed++) {
      const song = generateSong({ style: 'cosmic', seed, key: seed % 12 })
      const glide = (id: string): number => song.tracks.find((t) => t.id === id)!.glide
      expect(glide('fm4')).toBe(3)
      expect(glide('sq3')).toBe(3)
      for (const id of ['fm1', 'fm2', 'fm3', 'fm5', 'sq1', 'sq2']) expect(glide(id), id).toBe(0)
      for (const p of song.patterns) {
        for (const t of song.tracks) {
          const notes = p.notes[t.id] ?? []
          const where = `semilla ${seed} ${p.name} ${t.id}`
          notes.forEach((n, i) => {
            if (!n.slide) return
            // solo cantan ligado el tema y su segunda voz
            expect(['fm4', 'sq3'], where).toContain(t.id)
            slid++
            const prev = notes[i - 1]
            // ligada = pegada a una nota corta anterior, dentro del mismo compás (o del doble en el puente)
            expect(prev.step + prev.len, where).toBe(n.step)
            const slow = p.name === 'BRK' || p.name === 'INTRO' ? 2 : 1
            expect(prev.len, where).toBeLessThanOrEqual(3 * slow)
            expect(n.step % (16 * slow), where).not.toBe(0)
            if (t.id === 'fm4') expect(prev.note, where).not.toBe(n.note)
          })
        }
      }
      if ((pat(song, 'B').notes.fm4 ?? []).some((n) => n.slide)) themes++
    }
    // la mayoría de las ideas tienen notas de paso que se ligan; las solemnes (todo negras) no
    expect(themes).toBeGreaterThanOrEqual(20)
    expect(slid).toBeGreaterThan(400)
  })

  it('el PSG va escrito a nivel de consola: pistas a 100 y arpegio con el acento al máximo', () => {
    const song = generateSong({ style: 'cosmic', seed: 8, key: 2 })
    for (const id of ['sq1', 'sq2', 'sq3', 'noise']) expect(song.tracks.find((t) => t.id === id)!.vol, id).toBe(100)
    const arp = pat(song, 'A').notes.sq1 ?? []
    expect(Math.max(...arp.map((n) => n.vel))).toBe(15)
    const shaker = pat(song, 'A').notes.noise ?? []
    expect(Math.max(...shaker.map((n) => n.vel))).toBe(15)
    // el eco, por debajo de su arpegio
    const echo = pat(song, 'A').notes.sq2 ?? []
    expect(Math.max(...echo.map((n) => n.vel))).toBeLessThan(Math.max(...arp.map((n) => n.vel)))
    // y las cuerdas de A, un punto por detrás de las de B: ahí manda el arpegio
    const pad = (name: string): number => (pat(song, name).notes.fm2 ?? [])[0].vel
    expect(pad('A')).toBeLessThan(pad('B'))
  })
})

describe('techno minimal', () => {
  it('armonía estática: riff, bajo, blips y pulso no salen de la escala; el riff vive en una octava', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const song = generateSong({ style: 'minimal', seed, key: seed % 12 })
      expect(['minor', 'phrygian']).toContain(song.scale)
      const pcs = scaleById(song.scale).steps
      for (const p of song.patterns) {
        for (const id of ['fm1', 'fm4', 'sq1', 'sq2', 'sq3']) {
          for (const n of p.notes[id] ?? []) expect(pcs.includes(relPc(song, n.note)), `semilla ${seed} ${p.name} ${id} nota ${n.note}`).toBe(true)
        }
        const bell = (p.notes.fm4 ?? []).map((n) => n.note)
        if (bell.length) expect(Math.max(...bell) - Math.min(...bell)).toBeLessThanOrEqual(12)
      }
    }
  })

  it('909 a negras; el riff entra en la intro, el bajo en A, los stabs en B y el bombo se va en el puente', () => {
    for (const seed of [2, 8, 21, 50]) {
      const song = generateSong({ style: 'minimal', seed, key: 5 })
      for (const name of ['INTRO', 'A', 'B', 'FINAL', 'OUTRO']) {
        const p = pat(song, name)
        for (let bar = 0; bar < p.bars; bar++) expect(drumSteps(p, DR.KICK, bar), `${name} compás ${bar}`).toEqual([0, 4, 8, 12])
      }
      expect(pat(song, 'INTRO').notes.fm1 ?? []).toHaveLength(0)
      expect((pat(song, 'INTRO').notes.fm4 ?? []).length).toBeGreaterThan(0)
      expect((pat(song, 'A').notes.fm1 ?? []).length).toBeGreaterThan(0)
      expect(pat(song, 'A').notes.fm2 ?? []).toHaveLength(0)
      expect((pat(song, 'B').notes.fm2 ?? []).length).toBeGreaterThan(0)
      expect((pat(song, 'BRK').notes.ch6 ?? []).filter((n) => n.note === DR.KICK)).toHaveLength(0)
      // el riff es un patrón de un compás: el ritmo se repite idéntico
      const bell = pat(song, 'A').notes.fm4 ?? []
      const rhythm = (bar: number) => bell.filter((n) => Math.floor(n.step / 16) === bar).map((n) => n.step % 16)
      expect(rhythm(1)).toEqual(rhythm(0))
      expect(rhythm(5)).toEqual(rhythm(0))
    }
  })

  it('en varias semillas el dibujo melódico del riff se desfasa de un compás a otro', () => {
    let phasing = 0
    for (let seed = 1; seed <= 12; seed++) {
      const song = generateSong({ style: 'minimal', seed, key: 0 })
      const bell = pat(song, 'A').notes.fm4 ?? []
      const pitches = (bar: number) => bell.filter((n) => Math.floor(n.step / 16) === bar).map((n) => n.note).join(',')
      if (pitches(0) !== pitches(1)) phasing++
    }
    expect(phasing).toBeGreaterThanOrEqual(6)
  })

  it('la campana va al centro en la intro y en A, y salta de lado a lado cuando entran los stabs', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const song = generateSong({ style: 'minimal', seed, key: 0 })
      for (const name of ['INTRO', 'A', 'OUTRO']) expect((pat(song, name).notes.fm4 ?? []).every((n) => n.pan === undefined), `semilla ${seed} ${name}`).toBe(true)
      for (const name of ['B', 'BRK', 'FINAL']) {
        const bell = pat(song, name).notes.fm4 ?? []
        const sides = bell.filter((n) => n.pan !== undefined).map((n) => n.pan)
        expect(sides.includes('L') && sides.includes('R'), `semilla ${seed} ${name}`).toBe(true)
        // casi nunca dos golpes seguidos por el mismo lado: es un vaivén
        const runs = sides.filter((p, i) => i > 0 && p === sides[i - 1]).length
        expect(runs, `semilla ${seed} ${name}`).toBeLessThanOrEqual(sides.length / 3)
      }
      // las demás pistas no llevan panorama por nota
      for (const p of song.patterns) for (const t of song.tracks) if (t.id !== 'fm4') expect((p.notes[t.id] ?? []).every((n) => n.pan === undefined)).toBe(true)
    }
  })

  it('el bajo ácido liga los saltos de octava (como el slide de una 303) y la pista lleva portamento', () => {
    let acid = 0
    for (let seed = 1; seed <= 40; seed++) {
      const song = generateSong({ style: 'minimal', seed, key: 0 })
      const bass = pat(song, 'A').notes.fm1 ?? []
      const slid = bass.filter((n) => n.slide)
      if (song.tracks[0].inst !== 21) {
        expect(slid, `semilla ${seed}`).toHaveLength(0)
        continue
      }
      acid++
      expect(song.tracks[0].glide).toBe(3)
      expect(slid.length, `semilla ${seed}`).toBe(3 * pat(song, 'A').bars)
      for (const n of slid) {
        const prev = bass.find((m) => m.step + m.len === n.step)
        expect(prev, `semilla ${seed} paso ${n.step}`).toBeDefined()
      }
    }
    expect(acid).toBeGreaterThanOrEqual(3)
  })
})

describe('dark', () => {
  it('frigio: sin tercera mayor, tritono ni sexta mayor sobre la tónica; trémolo con el LFO del chip', () => {
    const allowed = new Set([0, 1, 2, 3, 5, 7, 8, 10, 11])
    for (let seed = 1; seed <= 24; seed++) {
      const song = generateSong({ style: 'dark', seed, key: seed % 12 })
      expect(song.scale).toBe('phrygian')
      expect(song.lfo).toBe(1)
      for (const p of song.patterns) {
        for (const t of pitched(song)) {
          for (const n of p.notes[t.id] ?? []) expect(allowed.has(relPc(song, n.note)), `semilla ${seed} ${p.name} ${t.id} nota ${n.note}`).toBe(true)
        }
      }
      // la melodía (theremin o campana) no sale de la escala frigia
      const pcs = scaleById('phrygian').steps
      for (const n of pat(song, 'B').notes.fm4 ?? []) expect(pcs.includes(relPc(song, n.note))).toBe(true)
    }
  })

  it('tiene dos caras: EBM (bajo en semicorcheas, más rápido) y giallo (pulso en corcheas, más lento)', () => {
    const tempos: number[] = []
    let dense = 0
    let sparse = 0
    for (let seed = 1; seed <= 16; seed++) {
      const song = generateSong({ style: 'dark', seed, key: 0 })
      tempos.push(song.bpm)
      const p = pat(song, 'A')
      const perBar = (p.notes.fm1 ?? []).length / p.bars
      if (perBar >= 10) dense++
      else sparse++
      // caja en 2 y 4 y bombo a negras en las secciones principales
      expect(drumSteps(p, DR.SNARE, 0)).toEqual([4, 12])
      expect(drumSteps(p, DR.KICK, 1)).toEqual([0, 4, 8, 12])
    }
    expect(dense).toBeGreaterThanOrEqual(3)
    expect(sparse).toBeGreaterThanOrEqual(3)
    expect(Math.min(...tempos)).toBeLessThanOrEqual(120)
    expect(Math.max(...tempos)).toBeGreaterThanOrEqual(122)
  })

  it('el theremin no ataca cada nota: se desliza dentro de la frase y respira al empezar la siguiente', () => {
    let theremins = 0
    let bells = 0
    for (let seed = 1; seed <= 30; seed++) {
      const song = generateSong({ style: 'dark', seed, key: seed % 12 })
      const lead = song.tracks.find((t) => t.id === 'fm4')!
      for (const name of ['B', 'BRK', 'FINAL']) {
        const notes = pat(song, name).notes.fm4 ?? []
        const where = `semilla ${seed} ${name}`
        if (lead.name === 'BELL') {
          // una campana se golpea: ni ligaduras ni portamento
          expect(lead.glide, where).toBe(0)
          expect(notes.some((n) => n.slide), where).toBe(false)
          continue
        }
        expect(lead.glide, where).toBe(5)
        notes.forEach((n, i) => {
          const prev = notes[i - 1]
          const joined = !!prev && prev.step + prev.len === n.step && prev.note !== n.note && n.step % 32 !== 0
          expect(!!n.slide, `${where} paso ${n.step}`).toBe(joined)
        })
      }
      if (lead.name === 'BELL') bells++
      else {
        theremins++
        expect((pat(song, 'B').notes.fm4 ?? []).some((n) => n.slide), `semilla ${seed}`).toBe(true)
      }
    }
    expect(theremins).toBeGreaterThanOrEqual(15)
    expect(bells).toBeGreaterThanOrEqual(1)
  })
})

describe('rellenar pista con los estilos electrónicos', () => {
  it('cada tipo de relleno escribe notas válidas en la pista pedida', () => {
    for (const style of ELECTRO) {
      const song = generateSong({ style, seed: 6, key: 3 })
      const p = song.patterns[1]
      const max = patternSteps(song, p)
      const pcsOk = (trackId: string, notes: { note: number }[]) => {
        for (const n of notes) {
          expect(n.note, `${style} ${trackId}`).toBeGreaterThanOrEqual(24)
          expect(n.note).toBeLessThanOrEqual(108)
        }
      }
      for (const [kind, track] of [
        ['bass', 'fm1'],
        ['chords', 'fm2'],
        ['arp', 'sq1'],
        ['lead', 'fm4'],
        ['drums', 'ch6'],
        ['drums', 'noise'],
        ['perc', 'noise'],
        ['perc', 'ch6'],
      ] as const) {
        const notes = generateTrackNotes(song, p, track, kind, 77, style)
        expect(notes.length, `${style} ${kind} → ${track}`).toBeGreaterThan(0)
        for (const n of notes) {
          expect(n.step + n.len).toBeLessThanOrEqual(max)
          expect(n.vel).toBeGreaterThanOrEqual(1)
          expect(n.vel).toBeLessThanOrEqual(15)
        }
        if (track === 'ch6') for (const n of notes) expect(n.note).toBeLessThan(song.drumKit.length)
        else if (track === 'noise') for (const n of notes) expect(n.note).toBeLessThan(song.noiseKit.length)
        else pcsOk(track, notes)
      }
      // la batería no se escribe en una pista melódica
      expect(generateTrackNotes(song, p, 'fm4', 'drums', 1, style)).toEqual([])
      // semillas distintas dan rellenos distintos
      const a = JSON.stringify(generateTrackNotes(song, p, 'fm4', 'lead', 1, style))
      const b = JSON.stringify(generateTrackNotes(song, p, 'fm4', 'lead', 2, style))
      expect(a).not.toBe(b)
    }
  })

  it('funcionan también sobre una canción en modo mayor y en 3/4', () => {
    const song = createEmptySong()
    song.scale = 'major'
    song.beatsPerBar = 3
    const p = song.patterns[0]
    for (const style of ELECTRO) {
      for (const [kind, track] of [
        ['bass', 'fm1'],
        ['chords', 'fm2'],
        ['arp', 'sq1'],
        ['lead', 'fm4'],
        ['drums', 'ch6'],
      ] as const) {
        const notes = generateTrackNotes(song, p, track, kind, 5, style)
        expect(notes.length, `${style} ${kind}`).toBeGreaterThan(0)
        for (const n of notes) expect(n.step + n.len).toBeLessThanOrEqual(patternSteps(song, p))
      }
    }
  })
})

describe('syndrum / láser (tipo de batería "zap")', () => {
  it('es un tono que cae: empieza agudo, acaba grave y respeta el nivel pedido', () => {
    const pcm = renderDrum({ name: 'SYNDRUM', kind: 'zap', pitch: 0.5, decay: 0.6, tone: 0.85, gain: 0.8 }, 14700)
    const crossings = (from: number, to: number): number => {
      let c = 0
      for (let i = from + 1; i < to; i++) if (pcm[i - 1] < 0 !== pcm[i] < 0) c++
      return c / (to - from)
    }
    const n = pcm.length
    expect(n / 14700).toBeGreaterThan(0.3)
    expect(crossings(0, 300)).toBeGreaterThan(crossings(n - 1500, n - 300) * 3)
    let pk = 0
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(pcm[i]))
    expect(pk).toBeGreaterThan(0.7)
    expect(pk).toBeLessThanOrEqual(0.8001)
    // cuanto más "tone", más cae: el final es más grave
    const shallow = renderDrum({ name: 'TOM', kind: 'zap', pitch: 0.5, decay: 0.6, tone: 0.1, gain: 0.8 }, 14700)
    let cs = 0
    for (let i = n - 1499; i < n - 300; i++) if (shallow[i - 1] < 0 !== shallow[i] < 0) cs++
    expect(cs / 1200).toBeGreaterThan(crossings(n - 1500, n - 300) * 1.5)
  })

  it('los tipos de sonido viajan en el enlace; uno desconocido cae en bombo', () => {
    const song = createEmptySong()
    song.drumKit[6] = { name: 'SYNDRUM', kind: 'zap', pitch: 0.5, decay: 0.6, tone: 0.85, gain: 0.8 }
    expect(songFromHash(songToHash(song)).drumKit[6].kind).toBe('zap')
    const odd = JSON.parse(JSON.stringify(packSong(song))) as { dk: { kind: string }[] }
    odd.dk[6].kind = 'gong'
    const hash = Buffer.from(deflateSync(strToU8(JSON.stringify(odd)), { level: 9 })).toString('base64url')
    expect(songFromHash(hash).drumKit[6].kind).toBe('kick')
  })
})

describe('timbal afinable y plato (tipos de batería "timp" y "crash")', () => {
  it('el timbal sube un semitono exacto por cada 1/24 de pitch y resuena más cuanto más decay', () => {
    const hz = (pitch: number): number => peakFreq(renderDrum({ name: 'T', kind: 'timp', pitch, decay: 0.8, tone: 0.45, gain: 0.8 }, 14700), 14700, 50)
    for (const p of [0.25, 0.5, 0.75]) {
      const cents = 1200 * Math.log2(hz(p + 1 / 24) / hz(p))
      expect(cents).toBeGreaterThan(90)
      expect(cents).toBeLessThan(110)
    }
    // pitch 0.5 = Do3 (130,8 Hz)
    expect(Math.abs(1200 * Math.log2(hz(0.5) / 130.81))).toBeLessThan(25)
    expect(timpPitch(48)).toBe(0.5)
    expect(timpPitch(36)).toBe(0)
    const short = renderDrum({ name: 'T', kind: 'timp', pitch: 0.5, decay: 0.1, tone: 0.45, gain: 0.8 }, 14700)
    const long = renderDrum({ name: 'T', kind: 'timp', pitch: 0.5, decay: 0.9, tone: 0.45, gain: 0.8 }, 14700)
    expect(long.length).toBeGreaterThan(short.length * 2)
    let pk = 0
    for (let i = 0; i < long.length; i++) pk = Math.max(pk, Math.abs(long[i]))
    expect(pk).toBeGreaterThan(0.7)
    expect(pk).toBeLessThanOrEqual(0.8001)
  })

  it('el plato es ruido brillante con cola: dura más que un charles abierto y se apaga', () => {
    const crash = renderDrum({ name: 'CRASH', kind: 'crash', pitch: 0.5, decay: 0.7, tone: 0.45, gain: 0.6 }, 14700)
    const ohat = renderDrum({ name: 'OPEN', kind: 'ohat', pitch: 0.5, decay: 0.45, tone: 0.5, gain: 0.7 }, 14700)
    expect(crash.length).toBeGreaterThan(ohat.length * 1.5)
    const n = crash.length
    const energy = (from: number, to: number): number => {
      let e = 0
      for (let i = from; i < to; i++) e += crash[i] * crash[i]
      return e / (to - from)
    }
    expect(energy(0, 1000)).toBeGreaterThan(energy(n - 2000, n - 1000) * 20)
    // sin tono definido: cruza por cero miles de veces por segundo
    let zc = 0
    for (let i = 1; i < 4000; i++) if (crash[i - 1] < 0 !== crash[i] < 0) zc++
    expect((zc / 4000) * 14700).toBeGreaterThan(3000)
  })
})

describe('enlaces compartidos: formato compacto de notas', () => {
  it('los enlaces antiguos (notas como [paso, duración, nota, velocidad]) se siguen leyendo', () => {
    const song = generateSong({ style: 'house', seed: 4, key: 2 })
    const legacy = packSong(song) as { pt: [string, string, number, Record<string, number[]>][] }
    const old = {
      ...legacy,
      pt: legacy.pt.map(([id, name, bars, notes]) => [
        id,
        name,
        bars,
        Object.fromEntries(
          Object.entries(notes).map(([k, flat]) => {
            const arr: number[][] = []
            let step = 0
            for (let i = 0; i < flat.length; i += 4) {
              step += flat[i]
              arr.push([step, flat[i + 1], flat[i + 2], flat[i + 3]])
            }
            return [k, arr]
          }),
        ),
      ]),
    }
    const hash = Buffer.from(deflateSync(strToU8(JSON.stringify(old)), { level: 9 })).toString('base64url')
    const back = songFromHash(hash)
    expect(back.patterns.map((p) => p.notes)).toEqual(song.patterns.map((p) => p.notes))
    expect(back.title).toBe(song.title)
  })

  it('el formato nuevo guarda distancias entre pasos: los compases repetidos se comprimen', () => {
    const song = generateSong({ style: 'era', seed: 7, key: 0 })
    const flat = (packSong(song).pt as [string, string, number, Record<string, number[]>][])[1][3].ch6
    expect(typeof flat[0]).toBe('number')
    expect(flat.length % 4).toBe(0)
    // el enlace de un tema ERA baja de ~7 KB a menos de 3 KB
    expect(songToHash(song).length).toBeLessThan(3000)
  })
})
