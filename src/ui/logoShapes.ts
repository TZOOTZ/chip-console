// ── Logotipo TZOOTZ: trébol · círculo · coma ────────────────────────────────
//
// Única fuente de las formas. Las usan el componente <Logo> y
// scripts/make-icons.mjs, que genera public/logo.svg, el favicon y los iconos
// PNG de la PWA. El dibujo original (exportado de Inkscape, con cientos de
// trazados invisibles) se conserva en docs/brand/logo-original.svg.
export const LOGO_W = 565.6
export const LOGO_H = 374.2

/** tres círculos fundidos */
export const LOGO_TREFOIL =
  'M143.517 85.1c-2.6 0-4.3-2.5-3.3-4.9 2.3-5.6 3.6-11.7 3.6-18.1 0-26.4-21.9-47.9-48.3-47.6-25.9.4-46.9 21.5-46.9 47.6 0 6.4 1.3 12.5 3.6 18.1 1 2.3-.7 4.9-3.3 4.9h-.1c-26.3 0-47.6 21.3-47.6 47.6 0 26.1 20.9 47.3 47 47.6 20.2.2 37.5-12.1 44.6-29.7 1.2-2.9 5.3-2.9 6.5 0 7.1 17.6 24.5 29.9 44.6 29.7 26.1-.3 47-21.4 47-47.6.2-26.3-21.1-47.6-47.4-47.6z'

export const LOGO_CIRCLE = { cx: 281.517, cy: 89.1, r: 88.6 }

/** la coma: abraza al círculo y se extiende como base de todo el conjunto */
export const LOGO_SWOOSH =
  'M472.301.401c-51.5.1-93.301 41.898-93.301 93.398v1c0 51.3-41.6 92.9-92.9 92.9H0v186.5h290.5c151.9 0 275.1-123.1 275.1-275.1v-5.4c0-51.5-41.799-93.299-93.299-93.299z'
