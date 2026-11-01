// ── Osciloscopio de fósforo + analizador de espectro ─────────────────────────
import { useEffect, useRef } from 'react'
import { engine } from '../engine/client'

export function Scope({ spectrum = true }: { spectrum?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    let raf = 0
    let time: Uint8Array<ArrayBuffer> | null = null
    let freq: Uint8Array<ArrayBuffer> | null = null
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (w === 0 || h === 0) return
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      g.fillStyle = 'rgba(2, 8, 5, 0.38)'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = 'rgba(0,244,142,0.08)'
      g.lineWidth = 1
      g.beginPath()
      for (let i = 1; i < 4; i++) {
        g.moveTo(0, (h / 4) * i)
        g.lineTo(w, (h / 4) * i)
      }
      g.moveTo(w / 2, 0)
      g.lineTo(w / 2, h)
      g.stroke()
      const an = engine.analyser
      if (!an) return
      if (!time || time.length !== an.fftSize) time = new Uint8Array(an.fftSize)
      if (!freq || freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount)
      an.getByteTimeDomainData(time)
      if (spectrum) {
        an.getByteFrequencyData(freq)
        const bars = 64
        const bw = w / bars
        g.fillStyle = 'rgba(74,216,255,0.28)'
        for (let b = 0; b < bars; b++) {
          // eje logarítmico
          const i0 = Math.floor(Math.pow(b / bars, 2.2) * (freq.length * 0.6)) + 1
          const i1 = Math.max(i0 + 1, Math.floor(Math.pow((b + 1) / bars, 2.2) * (freq.length * 0.6)) + 1)
          let m = 0
          for (let i = i0; i < i1; i++) m = Math.max(m, freq[i])
          const bh = (m / 255) * h
          g.fillRect(b * bw + 1, h - bh, bw - 2, bh)
        }
      }
      g.strokeStyle = '#00ff7b'
      g.lineWidth = 2 * dpr
      g.shadowColor = 'rgba(0,255,123,0.9)'
      g.shadowBlur = 8 * dpr
      g.beginPath()
      // sincroniza el disparo en el primer cruce ascendente
      let start = 0
      for (let i = 1; i < time.length / 2; i++) {
        if (time[i - 1] < 128 && time[i] >= 128) {
          start = i
          break
        }
      }
      const n = time.length / 2
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w
        const y = (time[start + i] / 255) * h
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      g.shadowBlur = 0
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [spectrum])

  return <canvas ref={ref} className="block h-full w-full" style={{ background: '#020805' }} aria-label="Osciloscopio" />
}
