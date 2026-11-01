// ── Muestras reales: del WAV al kit, al sintetizador, al enlace y al XGM ──
import { describe, expect, it } from 'vitest'
import { fromBase64, renderDrum, toBase64 } from '../src/engine/drums'
import { leerWav, prepararMuestra, vozDeMuestra } from '../src/export/muestra'
import { auditarPresupuesto } from '../src/export/presupuesto'
import { renderSong } from '../src/export/render'
import { songFromHash, songToHash } from '../src/export/share'
import { buildXgm } from '../src/export/xgm'
import { createEmptySong } from '../src/music/presets'
import { cleanDrumVoice, emptyPattern, sanitizeSong, type Song } from '../src/music/song'

/** un WAV de 24 bits, estéreo y a 48 kHz: un acorde cortado (dos senos) con ataque seco, de 300 ms */
function wav24(rate = 48000, ms = 300): Uint8Array {
  const n = Math.round((rate * ms) / 1000)
  const buf = new ArrayBuffer(44 + n * 6)
  const dv = new DataView(buf)
  const w = (o: number, s: string): void => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  dv.setUint32(4, 36 + n * 6, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 2, true)
  dv.setUint32(24, rate, true)
  dv.setUint32(28, rate * 6, true)
  dv.setUint16(32, 6, true)
  dv.setUint16(34, 24, true)
  w(36, 'data')
  dv.setUint32(40, n * 6, true)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    // 20 ms de silencio, y luego el chop con un decaimiento rápido
    const env = t < 0.02 ? 0 : Math.exp(-(t - 0.02) / 0.04)
    const s = (Math.sin(2 * Math.PI * 196 * t) + 0.6 * Math.sin(2 * Math.PI * 293.66 * t)) * 0.4 * env
    const v = Math.round(s * 8388607)
    for (let c = 0; c < 2; c++) {
      const o = 44 + (i * 2 + c) * 3
      dv.setUint8(o, v & 0xff)
      dv.setUint8(o + 1, (v >> 8) & 0xff)
      dv.setUint8(o + 2, (v >> 16) & 0xff)
    }
  }
  return new Uint8Array(buf)
}

describe('muestras reales', () => {
  it('lee un WAV de 24 bits estéreo y lo deja en mono', () => {
    const w = leerWav(wav24())
    expect(w.rate).toBe(48000)
    expect(w.channels).toBe(2)
    expect(w.samples.length).toBe(14400)
    expect(Math.max(...Array.from(w.samples.slice(2000, 4000)).map(Math.abs))).toBeGreaterThan(0.2)
  })

  it('prepara la muestra: sin silencio delante, recortada, a 8 bits y a la frecuencia del banco', () => {
    const w = leerWav(wav24())
    const m = prepararMuestra(w, { rate: 11025, ms: 60 })
    expect(m.rate).toBe(11025)
    expect(m.ms).toBeLessThanOrEqual(60.1)
    expect(m.bytes).toBe(m.pcm.length)
    // el golpe empieza en seguida (el silencio del principio se ha quitado) y el pico llega al tope
    expect(Math.abs(m.pcm[3] - 128)).toBeGreaterThan(10)
    expect(Math.max(...Array.from(m.pcm).map((b) => Math.abs(b - 128)))).toBeGreaterThanOrEqual(120)
    // acaba en silencio (fundido)
    expect(Math.abs(m.pcm[m.pcm.length - 1] - 128)).toBeLessThanOrEqual(3)
  })

  it('subir el tono ahorra bytes: una octava más aguda ocupa la mitad', () => {
    const w = leerWav(wav24())
    const a = prepararMuestra(w, { rate: 11025, ms: 300, pitch: 0 })
    const b = prepararMuestra(w, { rate: 11025, ms: 300, pitch: 12 })
    expect(b.bytes).toBeLessThan(a.bytes * 0.55)
    expect(b.bytes).toBeGreaterThan(a.bytes * 0.45)
  })

  it('un bucle dura exactamente lo pedido y empalma sin salto', () => {
    // un seno de 110 Hz de 2 s: no es periódico en el tramo recortado, y aun así el empalme no debe saltar
    const rate = 44100
    const samples = Float32Array.from({ length: rate * 2 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 110.3 * i) / rate))
    const m = prepararMuestra({ rate, channels: 1, samples }, { rate: 11025, ms: 1000, loop: true, desde: 120 })
    expect(m.bytes).toBe(11025)
    expect(m.ms).toBeCloseTo(1000, 3)
    // el salto entre el último y el primer byte no pasa de lo que se mueve el seno entre dos muestras
    const jump = Math.abs(m.pcm[m.pcm.length - 1] - m.pcm[0])
    const step = Math.max(...Array.from(m.pcm.slice(100, 400)).map((b, i, arr) => (i ? Math.abs(b - arr[i - 1]) : 0)))
    expect(jump).toBeLessThanOrEqual(step * 2 + 2)
    // y no se ha quitado el principio: un bucle conserva todo lo que dura
    expect(Math.abs(m.pcm[0] - 128)).toBeGreaterThan(0)
  })

  it('la afinación fina (centésimas de semitono) mueve la longitud en proporción', () => {
    const w = leerWav(wav24())
    const a = prepararMuestra(w, { rate: 11025, ms: 300, pitch: 0 })
    const b = prepararMuestra(w, { rate: 11025, ms: 300, pitch: 0.5 })
    expect(b.bytes / a.bytes).toBeCloseTo(Math.pow(2, -0.5 / 12), 2)
  })

  it('base64 va y vuelve sin perder un byte', () => {
    const u = Uint8Array.from({ length: 257 }, (_, i) => (i * 37) & 0xff)
    expect(Array.from(fromBase64(toBase64(u)))).toEqual(Array.from(u))
    expect(toBase64(u)).toBe(btoa(String.fromCharCode(...u)))
  })

  it('es un sonido del kit que se renderiza, se sanea y no se pierde', () => {
    const m = prepararMuestra(leerWav(wav24()), { rate: 11025, ms: 60 })
    const v = vozDeMuestra('skank dub', m, 0.8)
    expect(v.kind).toBe('sample')
    expect(v.name).toBe('SKANK DUB')
    const pcm = renderDrum(v, 14000)
    expect(pcm.length).toBe(Math.round((m.bytes / 11025) * 14000))
    expect(Math.max(...Array.from(pcm).map(Math.abs))).toBeCloseTo(0.8, 2)
    expect(cleanDrumVoice(JSON.parse(JSON.stringify(v)))).toEqual(v)
    // sin PCM válido vuelve a ser un sonido sintético
    expect(cleanDrumVoice({ ...v, pcm: '¡no es base64!' }).kind).toBe('cow')
  })

  function songWith(): Song {
    const s = createEmptySong()
    const m = prepararMuestra(leerWav(wav24()), { rate: 11025, ms: 60 })
    s.drumKit[6] = vozDeMuestra('SKANK', m, 0.9)
    s.patterns = []
    s.order = []
    const p = emptyPattern(s, 1, 'A')
    p.notes.ch6 = [{ step: 0, len: 1, note: 6, vel: 15 }, { step: 8, len: 1, note: 6, vel: 9 }]
    s.patterns.push(p)
    s.order.push(p.id)
    s.loopStart = -1
    return s
  }

  it('suena en el sintetizador y sobrevive al saneado y al enlace', () => {
    const s = songWith()
    const audio = renderSong(s, { sampleRate: 22050, tail: 0.3 })
    expect(Math.max(...Array.from(audio.left).map(Math.abs))).toBeGreaterThan(0.05)
    const clean = sanitizeSong(JSON.parse(JSON.stringify(s)), createEmptySong())
    expect(clean.drumKit[6]).toEqual(s.drumKit[6])
    const back = songFromHash(songToHash(s))
    expect(back.drumKit[6]).toEqual(s.drumKit[6])
  })

  it('entra en el XGM con su tamaño y el presupuesto la cuenta como sonido propio', () => {
    const s = songWith()
    const xgm = buildXgm(s)
    // la tabla de muestras del XGM (63 entradas de 4 bytes tras la marca): hay una muestra con longitud
    const dv = new DataView(xgm.buffer, xgm.byteOffset, xgm.byteLength)
    expect(dv.getUint16(4 + 2, true)).toBeGreaterThan(0)
    const p = auditarPresupuesto(s)
    const v = p.voces.find((x) => x.slot === 6)!
    expect(v.propia).toBe(true)
    expect(v.kind).toBe('sample')
    expect(v.ms).toBeGreaterThan(40)
    expect(v.ms).toBeLessThanOrEqual(61)
  })
})
