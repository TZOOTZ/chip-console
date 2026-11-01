// ── Presupuesto de ROM de un tema ───────────────────────────────────────────
//
// Mide lo que cuesta un tema en un cartucho y lo compara con diez reglas de ahorro de
// cartucho. Todo sale de las escrituras reales del driver y del XGC compilado (el mismo binario que
// acabaría en la ROM), no de estimaciones.
//
//   1 · un solo kit de batería para todos los temas: el 909 de TECHNO MINIMAL. Los sonidos propios
//       de un tema son 1-3 muestras cortas que caben en lo que queda libre del banco (4,9 KB)
//   2 · golpes cortos: 1 KB ≈ 94 ms; bombo ≤ 150 ms, caja y palmas ≤ 120 ms, charles ≤ 20 ms
//   3 · pocas dinámicas por golpe: cada nivel de velocidad es otra muestra (normal/acento o uno)
//   4 · charles y aire por el DAC, no por el ruido del PSG
//   5 · envolventes del PSG de 4 pasos como mucho; los sostenidos, en FM
//   6 · notas con intención: acordes en 3 canales FM, nunca un arpegio a 60 Hz en uno
//   7 · sin portamento, vibrato ni automatización de TL por frame salvo como firma del tema
//   8 · un parche por canal
//   9 · repetir exacto y variar poco
//  10 · sin coda ni fundido (el bucle vuelve solo), intro ≤ 4 compases, bucles de 1:10 a 1:40
import { deflateSync } from 'fflate'
import { renderDrum } from '../engine/drums'
import { KIT_909 } from '../music/electro'
import { getPattern, stepsPerBar, type DrumVoice, type Song, type Track } from '../music/song'
import { compileXgc } from './xgc'
import { captureWrites } from './vgm'
import { XGM_PCM_RATE, buildXgm, levelOf } from './xgm'

/** lo que queda libre en el banco de muestras junto al kit compartido (KB) */
export const BANCO_LIBRE_KB = 4.9
/** la cuenta de referencia: 1 KB de muestra son ~94 ms */
export const MS_POR_KB = 94

/** el tope de cada tipo de golpe propio (ms): la regla 2 */
export const TOPE_MS: Partial<Record<DrumVoice['kind'], number>> = { kick: 150, snare: 120, clap: 120, hat: 20, rim: 60, cow: 120, tom: 150, timp: 250, sample: 150 }

export interface VozUsada {
  slot: number
  name: string
  kind: DrumVoice['kind']
  golpes: number
  /** niveles de velocidad distintos que suenan (0 = 1,00 · 1 = 0,62 · 2 = 0,36) */
  niveles: number[]
  /** lo que dura la muestra */
  ms: number
  /** no es la del kit compartido: cuesta muestras nuevas */
  propia: boolean
}

export interface Presupuesto {
  // ── lo que ocupa ──
  bytesXgc: number
  /** comandos de música (sin muestras ni cabecera) */
  bytesMusica: number
  /** esos comandos comprimidos: cuánto se ahorra repitiendo exacto (si el cartucho los comprime) */
  bytesMusicaLz: number
  bytesMuestras: number
  // ── cuánto dura ──
  segundos: number
  compasesIntro: number
  segundosBucle: number
  bucle: boolean
  /** el último patrón es una coda (OUTRO/FIN/CODA) */
  coda: boolean
  // ── batería ──
  voces: VozUsada[]
  muestras: number
  propias: number
  propiasMs: number
  propiasKB: number
  // ── escrituras por segundo ──
  ymPorSeg: number
  psgPorSeg: number
  desglose: { teclas: number; frecuencia: number; nivel: number; parche: number; psgTono: number; psgVolumen: number }
  // ── uso de los canales ──
  /** notas del canal de ruido con voces de charles/caja (percusión corta) */
  ruidoPercusivo: number
  /** escrituras de volumen por nota en cada canal de tono del PSG */
  pasosPsg: number[]
  /** pistas con vibrato, portamento o envolvente de tono */
  modulacion: string[]
  /** pasos con más de una nota en una pista melódica (un acorde en un canal) */
  acordesEnUnCanal: number
  parches: { fm: number; psg: number }
  /** valores de velocidad distintos de cada pista con notas */
  velocidades: Record<string, number>
}

const sameVoice = (a: DrumVoice | undefined, b: DrumVoice | undefined): boolean =>
  !!a && !!b && a.kind === b.kind && a.pitch === b.pitch && a.decay === b.decay && a.tone === b.tone && a.gain === b.gain

const CODA = /^(OUTRO|FIN$|CODA)/i

export function auditarPresupuesto(song: Song, shared: DrumVoice[] = KIT_909): Presupuesto {
  const xgc = compileXgc(buildXgm(song))
  const cap = captureWrites(song, 0.2)

  // ── tiempos ──
  const barsOf = (id: string): number => getPattern(song, id)?.bars ?? 0
  const secPerBar = (stepsPerBar(song) * 15) / song.bpm
  const total = song.order.reduce((n, id) => n + barsOf(id), 0)
  const bucle = song.loopStart >= 0 && song.loopStart < song.order.length
  const intro = bucle ? song.order.slice(0, song.loopStart).reduce((n, id) => n + barsOf(id), 0) : 0
  const segundos = total * secPerBar
  const last = getPattern(song, song.order[song.order.length - 1] ?? '')

  // ── batería: golpes por sonido y niveles de velocidad ──
  const uso = new Map<number, { golpes: number; niveles: Set<number> }>()
  for (let i = 0; i < cap.drums.length; i += 3) {
    const slot = cap.drums[i + 1]
    const u = uso.get(slot) ?? { golpes: 0, niveles: new Set<number>() }
    u.golpes++
    u.niveles.add(levelOf(cap.drums[i + 2]))
    uso.set(slot, u)
  }
  const voces: VozUsada[] = [...uso.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, u]) => {
      const v = song.drumKit[slot]
      const ms = v ? (renderDrum(v, XGM_PCM_RATE).length / XGM_PCM_RATE) * 1000 : 0
      return {
        slot,
        name: v?.name ?? '?',
        kind: v?.kind ?? 'kick',
        golpes: u.golpes,
        niveles: [...u.niveles].sort(),
        ms,
        propia: !sameVoice(v, shared[slot]),
      }
    })
  const propias = voces.filter((v) => v.propia)
  // una muestra propia cuesta una vez por nivel que se use
  const propiasMs = propias.reduce((n, v) => n + v.ms * v.niveles.length, 0)

  // ── escrituras ──
  const d = { teclas: 0, frecuencia: 0, nivel: 0, parche: 0, psgTono: 0, psgVolumen: 0 }
  const volumen = [0, 0, 0, 0]
  for (let i = 0; i < cap.events.length; i += 4) {
    // lo que escribe el panic del final (silenciar el chip) no es música
    if (cap.events[i] >= cap.endSample) continue
    const kind = cap.events[i + 1]
    const a = cap.events[i + 2]
    const b = cap.events[i + 3]
    if (kind === 2) {
      if (a & 0x80) {
        const ch = (a >> 5) & 3
        if (a & 0x10) {
          d.psgVolumen++
          volumen[ch]++
        } else d.psgTono++
      }
      continue
    }
    if (a === 0x28) {
      if (b & 0xf0) d.teclas++
    } else if (a >= 0xa0 && a <= 0xa6) {
      if (a < 0xa4) d.frecuencia++
    } else if (a >= 0x40 && a <= 0x4f) d.nivel++
    else if ((a >= 0x30 && a <= 0x3f) || (a >= 0x50 && a <= 0x9f) || (a >= 0xb0 && a <= 0xb6)) d.parche++
  }
  const sec = Math.max(0.001, (cap.endSample / 44100) - 0.2)
  const per = (n: number): number => Math.round((n / sec) * 10) / 10

  // ── pistas: lo que se toca, en el orden de la canción ──
  const played = new Map<string, number>()
  const vels = new Map<string, Set<number>>()
  const seen = new Set<string>()
  let acordes = 0
  let ruidoPercusivo = 0
  const used = new Set<string>()
  for (const id of song.order) {
    const p = getPattern(song, id)
    if (!p) continue
    for (const t of song.tracks) {
      const notes = p.notes[t.id] ?? []
      played.set(t.id, (played.get(t.id) ?? 0) + notes.length)
      if (notes.length) used.add(t.id)
      const set = vels.get(t.id) ?? new Set<number>()
      for (const n of notes) set.add(n.vel)
      vels.set(t.id, set)
      if (seen.has(p.id)) continue
      if (t.kind === 'fm' || t.kind === 'psg') {
        const at = new Map<number, number>()
        for (const n of notes) at.set(n.step, (at.get(n.step) ?? 0) + 1)
        for (const c of at.values()) if (c > 1) acordes++
      }
      if (t.kind === 'noise') {
        for (const n of notes) {
          const v = song.noiseKit[n.note]
          // percusión corta: charles, cajas… (las voces largas son aire, mar o motor)
          if (v && n.len <= 4 && v.a + v.d + v.r <= 20) ruidoPercusivo++
        }
      }
    }
    seen.add(p.id)
  }

  const pasosPsg = [0, 1, 2].map((ch) => {
    const t = song.tracks.find((x) => x.kind === 'psg' && x.ch === ch)
    const n = t ? played.get(t.id) ?? 0 : 0
    // (la primera escritura de cada canal es el silencio inicial del reset, no una nota)
    return n ? Math.round(((Math.max(0, volumen[ch] - 1)) / n) * 10) / 10 : 0
  })

  const modulacion: string[] = []
  const fmUsed = new Set<number>()
  const psgUsed = new Set<number>()
  const track = (t: Track): void => {
    if (!used.has(t.id)) return
    if (t.kind === 'fm') {
      fmUsed.add(t.inst)
      const p = song.fmBank[t.inst]
      if (p?.vib) modulacion.push(`${t.id} vibrato`)
      if (p?.pitchEnv) modulacion.push(`${t.id} envolvente de tono`)
    } else if (t.kind === 'psg') {
      psgUsed.add(t.inst)
      const p = song.psgBank[t.inst]
      if (p?.vib) modulacion.push(`${t.id} vibrato`)
      if (p?.pitchEnv) modulacion.push(`${t.id} envolvente de tono`)
    }
    if ((t.kind === 'fm' || t.kind === 'psg') && t.glide > 0) {
      const slid = song.order.some((id) => (getPattern(song, id)?.notes[t.id] ?? []).some((n) => n.slide))
      if (slid) modulacion.push(`${t.id} portamento`)
    }
  }
  song.tracks.forEach(track)

  const velocidades: Record<string, number> = {}
  for (const [id, set] of vels) if (set.size) velocidades[id] = set.size

  return {
    bytesXgc: xgc.data.length,
    bytesMusica: xgc.data.length - 0x104 - xgc.sampleBytes,
    bytesMusicaLz: deflateSync(xgc.data.subarray(0x104 + xgc.sampleBytes), { level: 9 }).length,
    bytesMuestras: xgc.sampleBytes,
    segundos,
    compasesIntro: intro,
    segundosBucle: bucle ? (total - intro) * secPerBar : 0,
    bucle,
    coda: bucle && !!last && CODA.test(last.name),
    voces,
    muestras: voces.reduce((n, v) => n + v.niveles.length, 0),
    propias: propias.length,
    propiasMs,
    propiasKB: propiasMs / MS_POR_KB,
    ymPorSeg: per(d.teclas + d.frecuencia + d.nivel + d.parche),
    psgPorSeg: per(d.psgTono + d.psgVolumen),
    desglose: {
      teclas: per(d.teclas),
      frecuencia: per(d.frecuencia),
      nivel: per(d.nivel),
      parche: per(d.parche),
      psgTono: per(d.psgTono),
      psgVolumen: per(d.psgVolumen),
    },
    ruidoPercusivo,
    pasosPsg,
    modulacion,
    acordesEnUnCanal: acordes,
    parches: { fm: fmUsed.size, psg: psgUsed.size },
    velocidades,
  }
}

// ── las reglas ──────────────────────────────────────────────────────────────
export interface Regla {
  n: number
  nombre: string
  ok: boolean
  detalle: string
}

export interface Excepciones {
  /** pistas cuya modulación es la firma del tema (regla 7) */
  firma?: string[]
  /** intro más larga por diseño (regla 10), en compases */
  introMax?: number
}

export function reglas(p: Presupuesto, ex: Excepciones = {}): Regla[] {
  const out: Regla[] = []
  const r = (n: number, nombre: string, ok: boolean, detalle: string): void => {
    out.push({ n, nombre, ok, detalle })
  }
  const propias = p.voces.filter((v) => v.propia)
  r(
    1,
    'un solo kit',
    propias.length <= 3 && p.propiasKB <= BANCO_LIBRE_KB,
    propias.length ? `${propias.length} propias · ${p.propiasKB.toFixed(1)} KB de ${BANCO_LIBRE_KB}` : 'solo el 909',
  )
  const largas = propias.filter((v) => v.ms > (TOPE_MS[v.kind] ?? 150))
  r(2, 'golpes cortos', largas.length === 0, largas.length ? largas.map((v) => `${v.name} ${Math.round(v.ms)} ms`).join(' · ') : 'propias dentro del tope')
  const niveles = p.voces.filter((v) => v.niveles.length > 2)
  r(3, 'pocas dinámicas', niveles.length === 0, `${p.muestras} muestras (voz × nivel)`)
  r(4, 'charles y aire por el DAC', p.ruidoPercusivo === 0, p.ruidoPercusivo ? `${p.ruidoPercusivo} golpes en el ruido` : 'ruido sin percusión')
  const pesadas = p.pasosPsg.filter((s) => s > 4)
  r(5, 'envolventes del PSG ≤ 4 pasos', pesadas.length === 0, `escrituras de volumen por nota: ${p.pasosPsg.join(' · ')}`)
  r(6, 'sin arpegios a 60 Hz', p.acordesEnUnCanal === 0, p.acordesEnUnCanal ? `${p.acordesEnUnCanal} pasos con acorde en un canal` : 'acordes repartidos en canales')
  const firma = new Set(ex.firma ?? [])
  const extra = p.modulacion.filter((m) => !firma.has(m.split(' ')[0]))
  r(7, 'modulación solo como firma', extra.length === 0, p.modulacion.length ? p.modulacion.join(' · ') : 'ninguna')
  r(8, 'un parche por canal', true, `${p.parches.fm} parches FM · ${p.parches.psg} PSG`)
  const intro = ex.introMax ?? 4
  const okLoop = !p.bucle || (p.segundosBucle >= 70 && p.segundosBucle <= 100)
  r(
    10,
    'bucle limpio',
    p.compasesIntro <= intro && !p.coda && okLoop,
    `intro ${p.compasesIntro} compases · bucle ${Math.round(p.segundosBucle)} s${p.coda ? ' · con coda' : ''}`,
  )
  return out
}

/** `1,2 KB` / `341 B` */
export const fmtBytes = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
