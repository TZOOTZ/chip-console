// ── Escala automática de la interfaz según la resolución ─────────────────────
import { describe, expect, it } from 'vitest'
import { autoScale } from '../src/ui/hooks'

describe('escala automática de la interfaz', () => {
  it('resoluciones 16:9 habituales', () => {
    expect(autoScale(1280, 720)).toBe(1)
    expect(autoScale(1366, 768)).toBe(1)
    expect(autoScale(1600, 900)).toBe(1)
    expect(autoScale(1920, 1080)).toBe(1.25)
    expect(autoScale(2560, 1440)).toBe(1.65)
    expect(autoScale(3840, 2160)).toBe(2.5)
  })

  it('al ampliar, el lienzo de diseño nunca es menor que el base (1536×864)', () => {
    for (let w = 1536; w <= 5120; w += 37) {
      const h = Math.round((w * 9) / 16)
      const s = autoScale(w, h)
      expect(s).toBeGreaterThanOrEqual(1)
      expect(s).toBeLessThanOrEqual(2.5)
      if (s > 1 && s < 2.5) {
        expect(w / s).toBeGreaterThanOrEqual(1536 - 1e-6)
        expect(h / s).toBeGreaterThanOrEqual(864 - 1)
      }
    }
  })

  it('manda el lado más justo: ultrapanorámico, 16:10 y móvil', () => {
    expect(autoScale(3440, 1440)).toBe(1.65)
    expect(autoScale(1920, 1200)).toBe(1.25)
    expect(autoScale(390, 844)).toBe(1)
    expect(autoScale(760, 1200)).toBe(1)
  })
})
