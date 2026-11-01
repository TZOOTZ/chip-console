import { useSyncExternalStore } from 'react'

/** suscripción reactiva a una media query CSS */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

/** tamaño de la ventana en px físicos de CSS (se actualiza al redimensionar) */
export function useViewport(): { w: number; h: number } {
  // el snapshot es un string para que sea estable entre renders
  const key = useSyncExternalStore(
    subscribeResize,
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => '1366x768',
  )
  const [w, h] = key.split('x').map(Number)
  return { w, h }
}

/**
 * Escala automática de la interfaz. El diseño base está pensado para 1536×864:
 * por debajo no se reduce (mínimo 100 %) y por encima crece en pasos del 5 %,
 * siempre a la baja para que el lienzo de diseño nunca sea menor que el base.
 *   1366×768 → 1.00 · 1600×900 → 1.00 · 1920×1080 → 1.25 · 2560×1440 → 1.65 · 4K → 2.5
 */
export function autoScale(w: number, h: number): number {
  if (w <= 760) return 1
  const s = Math.min(w / 1536, h / 864)
  return Math.max(1, Math.min(2.5, Math.floor(s * 20 + 1e-6) / 20))
}
