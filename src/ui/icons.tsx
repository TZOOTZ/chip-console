// ── Iconos SVG (heredan el color con currentColor; el tamaño lo da el CSS) ───
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const Icon = {
  play: (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M2.5 1.2l8 4.8-8 4.8z" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <rect x="2" y="2" width="8" height="8" rx="0.6" />
    </svg>
  ),
  rewind: (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <rect x="1.5" y="2" width="1.6" height="8" />
      <path d="M10.5 2L4 6l6.5 4z" />
    </svg>
  ),
  rec: (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <circle cx="6" cy="6" r="4.2" />
    </svg>
  ),
  loop: (
    <svg viewBox="0 0 14 12" {...S} aria-hidden>
      <path d="M3 4h7a2 2 0 012 2v0a2 2 0 01-2 2H4" />
      <path d="M5 1.5L2.5 4 5 6.5M9 5.5L11.5 8 9 10.5" />
    </svg>
  ),
  metro: (
    <svg viewBox="0 0 12 13" {...S} aria-hidden>
      <path d="M3 12L4.5 1.5h3L9 12z" />
      <path d="M6 9L9.5 3" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 13 12" {...S} aria-hidden>
      <path d="M4 2L1.5 4.5 4 7" />
      <path d="M2 4.5h6a3 3 0 010 6H5" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 13 12" {...S} aria-hidden>
      <path d="M9 2l2.5 2.5L9 7" />
      <path d="M11 4.5H5a3 3 0 000 6h3" />
    </svg>
  ),
  dice: (
    <svg viewBox="0 0 14 14" {...S} strokeWidth={1.5} aria-hidden>
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
      <circle cx="4.5" cy="4.5" r="0.9" fill="currentColor" />
      <circle cx="9.5" cy="9.5" r="0.9" fill="currentColor" />
      <circle cx="9.5" cy="4.5" r="0.9" fill="currentColor" />
      <circle cx="4.5" cy="9.5" r="0.9" fill="currentColor" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 14 14" {...S} strokeWidth={1.4} aria-hidden>
      <circle cx="7" cy="7" r="2.1" />
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8L9.8 4.2M4.2 9.8l-1.4 1.4" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 14 14" {...S} strokeWidth={1.5} aria-hidden>
      <circle cx="7" cy="7" r="5.6" />
      <path d="M5.3 5.5a1.8 1.8 0 113 1.3c-.7.6-1.3 1-1.3 1.9" />
      <circle cx="7" cy="10.4" r="0.5" fill="currentColor" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 14 14" {...S} strokeWidth={1.5} aria-hidden>
      <circle cx="3.2" cy="7" r="1.7" />
      <circle cx="10.8" cy="3.2" r="1.7" />
      <circle cx="10.8" cy="10.8" r="1.7" />
      <path d="M4.7 6.2l4.6-2.3M4.7 7.8l4.6 2.3" />
    </svg>
  ),
  export: (
    <svg viewBox="0 0 14 14" {...S} strokeWidth={1.6} aria-hidden>
      <path d="M7 1.5v7.2M4 6l3 3 3-3" />
      <path d="M2 10.5v1.5h10v-1.5" />
    </svg>
  ),
  keys: (
    <svg viewBox="0 0 16 12" {...S} strokeWidth={1.4} aria-hidden>
      <rect x="1" y="1.5" width="14" height="9" rx="1" />
      <path d="M5 1.5v9M8 1.5v9M11 1.5v9" />
      <path d="M4 1.5v5h2v-5M7 1.5v5h2v-5M10 1.5v5h2v-5" fill="currentColor" stroke="none" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M6 2v8M2 6h8" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M2 6h8" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 13 13" {...S} strokeWidth={1.4} aria-hidden>
      <rect x="4.2" y="4.2" width="7.3" height="7.3" rx="1" />
      <path d="M8.8 4.2V2.5a1 1 0 00-1-1H2.5a1 1 0 00-1 1v5.3a1 1 0 001 1h1.7" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 13 13" {...S} strokeWidth={1.4} aria-hidden>
      <path d="M2 3.5h9M5 3.5V2h3v1.5M3.2 3.5l.6 7.5h5.4l.6-7.5M5.4 5.6v3.6M7.6 5.6v3.6" />
    </svg>
  ),
  left: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M7.5 2.5L4 6l3.5 3.5" />
    </svg>
  ),
  right: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M4.5 2.5L8 6 4.5 9.5" />
    </svg>
  ),
  down: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M2.5 4.5L6 8l3.5-3.5" />
    </svg>
  ),
  up: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M2.5 7.5L6 4l3.5 3.5" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.8} aria-hidden>
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.6} aria-hidden>
      <path d="M7 1.5h3.5V5M5 10.5H1.5V7M10.5 1.5L6.8 5.2M1.5 10.5l3.7-3.7" />
    </svg>
  ),
  fit: (
    <svg viewBox="0 0 14 12" {...S} strokeWidth={1.6} aria-hidden>
      <path d="M1.5 2v8M12.5 2v8M4 6h6M5.5 4L3.5 6l2 2M8.5 4l2 2-2 2" />
    </svg>
  ),
  dockRight: (
    <svg viewBox="0 0 14 12" {...S} strokeWidth={1.4} aria-hidden>
      <rect x="1" y="1.5" width="12" height="9" rx="1" />
      <path d="M9 1.5v9" />
      <rect x="9.6" y="2.2" width="2.8" height="7.6" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  ),
  dockBottom: (
    <svg viewBox="0 0 14 12" {...S} strokeWidth={1.4} aria-hidden>
      <rect x="1" y="1.5" width="12" height="9" rx="1" />
      <path d="M1 7h12" />
      <rect x="1.7" y="7.6" width="10.6" height="2.3" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  ),
  newFile: (
    <svg viewBox="0 0 12 13" {...S} strokeWidth={1.4} aria-hidden>
      <path d="M7 1.5H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1v-6z" />
      <path d="M7 1.5v3h3M6 6.5v3M4.5 8h3" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 12 12" {...S} strokeWidth={1.5} aria-hidden>
      <path d="M4.5 9V2.5l5-1V8" />
      <circle cx="3.2" cy="9" r="1.4" fill="currentColor" />
      <circle cx="8.2" cy="8" r="1.4" fill="currentColor" />
    </svg>
  ),
}
