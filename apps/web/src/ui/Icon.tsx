/** A small set of stroke icons (24-unit grid, 1.6 stroke), drawn for this app. */
import type { SVGProps } from "react";

const PATHS = {
  decks: "M4 7.5 12 4l8 3.5-8 3.5-8-3.5Z M4 12l8 3.5 8-3.5 M4 16.5 12 20l8-3.5",
  browse: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M15.5 15.5 20 20",
  stats: "M5 20V11 M10 20V5 M15 20v-7 M20 20V8",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.4a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.5 2.4h4l.5-2.4a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5Z",
  import: "M12 4v11 M7.5 10.5 12 15l4.5-4.5 M4 15v4h16v-4",
  export: "M12 15V4 M7.5 8.5 12 4l4.5 4.5 M4 15v4h16v-4",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronDown: "M6 9.5l6 6 6-6",
  chevronLeft: "M14.5 6l-6 6 6 6",
  plus: "M12 5v14 M5 12h14",
  more: "M6 12h.01 M12 12h.01 M18 12h.01",
  refresh: "M20 4.5v5h-5 M19.6 9a8 8 0 1 0 .1 5.6",
  update: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z M12 7.8v7.6 M8.8 12.3l3.2 3.2 3.2-3.2",
  undo: "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  flag: "M5 21V4 M5 4h11l-2 4 2 4H5",
  edit: "M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4",
  pause: "M9 5v14 M15 5v14",
  bury: "M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 8h.01",
  close: "M6 6l12 12 M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  play: "M7 4.5v15l12-7.5-12-7.5Z",
  keyboard: "M3 6.5h18v11H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10",
  arrowLeft: "M19 12H5 M11 6l-6 6 6 6",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  file: "M14 3H6v18h12V7l-4-4Z M14 3v4h4",
  image: "M4 5.5h16v13H4z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17.5",
  code: "M8.5 7 3.5 12l5 5 M15.5 7l5 5-5 5",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  move: "M4 12h16 M16 8l4 4-4 4",
  warning: "M12 4 2.5 20h19L12 4Z M12 10v4.5 M12 17.5h.01",
  lock: "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  pin: "M9 4h6 M10 4l-1 6-2.5 2.5V14h11v-1.5L15 10l-1-6 M12 14v6.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
