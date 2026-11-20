import { useId } from "react";

/** The Wengu Leitner card-box emblem used in the topbar (.seal) and boot screen (.seal-lg). */
export function BrandMark({ large }: { large?: boolean }) {
  const id = useId();
  const boxId = `${id}-box`;
  const cardId = `${id}-card`;
  return (
    <span className={large ? "seal seal-lg" : "seal"} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="seal-svg" focusable="false">
        <defs>
          <linearGradient id={boxId} x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#ff8356" />
            <stop offset="52%" stopColor="#f26a3d" />
            <stop offset="100%" stopColor="#dc5023" />
          </linearGradient>
          <linearGradient id={cardId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f5efe4" />
          </linearGradient>
        </defs>
        <ellipse cx="32" cy="54.5" rx="20.5" ry="3.5" fill="#8b4d29" opacity="0.16" />
        <rect x="9.5" y="24.5" width="45" height="25" rx="7.5" fill="#c4441b" />
        <rect x="15" y="11" width="12" height="14.5" rx="4" fill="#3d8bf0" />
        <rect x="37" y="11" width="12" height="14.5" rx="4" fill="#1fae7a" />
        <rect x="26" y="13.2" width="12" height="14.5" rx="4" fill="#f1a62a" />
        <rect x="14.5" y="18" width="35" height="23.5" rx="5.2" fill="#e8e1d3" />
        <rect x="14" y="20.6" width="36" height="23.5" rx="5.2" fill="#f3ede1" />
        <rect x="13.5" y="23.2" width="37" height="24.5" rx="5.6" fill={`url(#${cardId})`} stroke="#dfd6c5" strokeWidth="1.2" />
        <path
          d="M8,33 C8,30.6 9.9,28.7 12.3,28.7 L21.8,28.7 C23.7,28.7 24.6,29.9 25.1,31.5 C26.2,35.1 28.9,37.7 32,37.7 C35.1,37.7 37.8,35.1 38.9,31.5 C39.4,29.9 40.3,28.7 42.2,28.7 L51.7,28.7 C54.1,28.7 56,30.6 56,33 L56,45.2 C56,49.9 52.2,53.7 47.5,53.7 L16.5,53.7 C11.8,53.7 8,49.9 8,45.2 Z"
          fill="#bd3f18"
        />
        <path
          d="M8,31.4 C8,29 9.9,27.1 12.3,27.1 L21.8,27.1 C23.7,27.1 24.6,28.3 25.1,29.9 C26.2,33.5 28.9,36.1 32,36.1 C35.1,36.1 37.8,33.5 38.9,29.9 C39.4,28.3 40.3,27.1 42.2,27.1 L51.7,27.1 C54.1,27.1 56,29 56,31.4 L56,42.6 C56,47.3 52.2,51.1 47.5,51.1 L16.5,51.1 C11.8,51.1 8,47.3 8,42.6 Z"
          fill={`url(#${boxId})`}
        />
        <path
          d="M9.6,31 C9.6,29.2 10.8,28 12.6,28 L21.5,28 C23.1,28 23.9,29.1 24.4,30.6 C25.6,34.4 28.6,37 32,37 C35.4,37 38.4,34.4 39.6,30.6 C40.1,29.1 40.9,28 42.5,28 L51.4,28 C53.2,28 54.4,29.2 54.4,31"
          fill="none"
          stroke="rgba(255,255,255,0.44)"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
