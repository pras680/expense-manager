// One small stroke-icon set for the whole app, drawn on a 24px grid. Icons
// replace the emoji the old screens used as glyphs: emoji render differently
// on every platform and can't take the theme's colour.
//
// Each entry is a list of SVG path strings; "c:cx,cy,r" is shorthand for a
// circle so the common dot/wheel shapes stay readable.

const ICONS = {
  // Navigation and actions
  home: ['M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z'],
  chart: ['M5 20v-7', 'M12 20V5', 'M19 20V10'],
  plus: ['M12 5v14', 'M5 12h14'],
  receipt: ['M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1z', 'M9 8h6', 'M9 12h6'],
  user: ['c:12,8,4', 'M4 21a8 8 0 0 1 16 0'],
  users: ['c:9,8,3.5', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.6a3.5 3.5 0 0 1 0 6.8', 'M18.5 14.6a6.5 6.5 0 0 1 3 5.4'],
  'chevron-right': ['M9 5l7 7-7 7'],
  'chevron-left': ['M15 5l-7 7 7 7'],
  search: ['c:11,11,7', 'M20 20l-3.5-3.5'],
  sparkles: ['M11 4l1.7 4.8L17.5 10.5l-4.8 1.7L11 17l-1.7-4.8L4.5 10.5l4.8-1.7z', 'M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
  send: ['M5 12h14', 'M13 6l6 6-6 6'],
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z', 'c:12,13,3'],
  text: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  refresh: ['M20 11A8 8 0 0 0 5.3 8', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.7 3', 'M20 20v-4h-4'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1'],
  lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  mail: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
  message: ['M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  currency: ['M12 3v18', 'M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.2-4.5 3 2 2.7 4.5 3 4.5 1.3 4.5 3.2-2 3.3-4.5 3.3-4.5-1.5-4.5-3.3'],
  palette: ['M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2a4 4 0 0 0 4-4c0-4-4-7.3-9-7.3z', 'M7.5 12h.01', 'M9.5 8h.01', 'M14 7.5h.01'],
  logout: ['M9 4H5v16h4', 'M15 8l4 4-4 4', 'M19 12H9'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  swap: ['M7 4L3 8l4 4', 'M3 8h14', 'M17 12l4 4-4 4', 'M21 16H7'],
  tag: ['M3 12V4h8l10 10-8 8z', 'M7.5 8h.01'],
  sort: ['M7 20V4', 'M3 8l4-4 4 4', 'M17 4v16', 'M13 16l4 4 4-4'],

  // Categories
  cart: ['M3 4h2l2.4 11h10.2L20 7H6.2', 'c:9,19,1.3', 'c:17,19,1.3'],
  utensils: ['M7 3v18', 'M4.5 3v5a2.5 2.5 0 0 0 5 0V3', 'M17 3c-2 1.5-3 4-3 7.5h3', 'M17 3v18'],
  monitor: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4'],
  shirt: ['M8 3L3 7l2.5 3L7 9v12h10V9l1.5 1L21 7l-5-4a4 4 0 0 1-8 0z'],
  ticket: ['M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z', 'M10 7v10'],
  fuel: ['M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16', 'M4 21h11', 'M7.5 8h4v3h-4z', 'M14 11h1.5a2 2 0 0 1 2 2v3a1.5 1.5 0 0 0 3 0V8.5L18 6'],
  bolt: ['M13 2L5 13h6l-1 9 8-11h-6z'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  plane: ['M21 3L3 10.5l6.5 3 3 6.5z', 'M9.5 13.5L21 3'],
  car: ['M5 16l1.5-5.5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16', 'M3 16h18v3H3z', 'M7 19v1.5', 'M17 19v1.5'],
  heart: ['M12 20s-7.5-4.5-7.5-10a4.3 4.3 0 0 1 7.5-2.5 4.3 4.3 0 0 1 7.5 2.5c0 5.5-7.5 10-7.5 10z'],
  repeat: ['M17 3l3 3-3 3', 'M4 11V9a3 3 0 0 1 3-3h13', 'M7 21l-3-3 3-3', 'M20 13v2a3 3 0 0 1-3 3H4'],
  briefcase: ['M4 8h16v11H4z', 'M9 8V5h6v3', 'M4 13h16'],
  card: ['M3 6h18v12H3z', 'M3 10h18', 'M7 15h3'],
  banknote: ['M3 7h18v10H3z', 'c:12,12,2.5', 'M6.5 10v4', 'M17.5 10v4']
} as const

export type IconName = keyof typeof ICONS

function circlePath(spec: string): string {
  const [cx, cy, r] = spec.slice(2).split(',').map(Number)
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

/** Decorative by default (aria-hidden): the control around it carries the label. */
export function Icon({ name, size = 20, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d.startsWith('c:') ? circlePath(d) : d} />
      ))}
    </svg>
  )
}
