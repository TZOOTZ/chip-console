// utilidades de UI sin componentes
export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')

/** px de diseño (a escala 100 %) → rem, para que todo siga la escala de interfaz */
export const rem = (px: number): string => `${px / 16}rem`

export const KIND_COLOR: Record<string, string> = {
  fm: 'var(--c-fm)',
  psg: 'var(--c-psg)',
  noise: 'var(--c-noise)',
  dac: 'var(--c-dac)',
}

/** colores literales para dibujar en canvas (que no resuelve variables CSS) */
export const KIND_HEX: Record<string, string> = {
  fm: '#00f48e',
  psg: '#4ad8ff',
  noise: '#ff7ad9',
  dac: '#ffc94a',
}

export const KIND_TAG: Record<string, string> = { fm: 'FM', psg: 'SQ', noise: 'NZ', dac: 'PCM' }

/** paleta para distinguir patrones/secciones en el arreglo */
export const PATTERN_HEX = ['#00f48e', '#4ad8ff', '#ffc94a', '#ff7ad9', '#a78bfa', '#7ee787', '#ff9f5a', '#5eead4']

/** captura el puntero sin romper si el id ya no está activo (eventos sintéticos, táctil...) */
export function capturePointer(e: { currentTarget: EventTarget; pointerId: number }): void {
  try {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  } catch {
    /* el puntero no está activo: seguimos sin captura */
  }
}
