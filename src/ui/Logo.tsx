// ── Logotipo TZOOTZ (hereda el color con currentColor; el tamaño lo da el CSS) ─
import { LOGO_CIRCLE, LOGO_H, LOGO_SWOOSH, LOGO_TREFOIL, LOGO_W } from './logoShapes'

/** Con `title` es una imagen con nombre accesible; sin él, puro adorno. */
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${LOGO_W} ${LOGO_H}`} fill="currentColor" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path className="logo-a" d={LOGO_TREFOIL} />
      <circle className="logo-b" cx={LOGO_CIRCLE.cx} cy={LOGO_CIRCLE.cy} r={LOGO_CIRCLE.r} />
      <path className="logo-c" d={LOGO_SWOOSH} />
    </svg>
  )
}
