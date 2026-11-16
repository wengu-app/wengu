/**
 * Media references in rendered card HTML and CSS. Dependency-free so the main thread can use it to swap file
 * names for object URLs without pulling in the engine.
 */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

// ------------------------------------------------------------------------------------------------
// Media references in rendered HTML
// ------------------------------------------------------------------------------------------------

const SRC_ATTR = /\b(src|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const SOUND = /\[sound:(.+?)\]/g;

function isLocalName(name: string): boolean {
  return name.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(name) && !name.startsWith("/") && !name.startsWith("#");
}

/** File names of local media referenced from HTML (src/data attributes, [sound:…]) and CSS (url(…)). */
export function mediaReferences(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(SRC_ATTR)) {
    const v = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    if (isLocalName(v)) out.add(v);
  }
  for (const m of html.matchAll(CSS_URL)) {
    const v = m[1] ?? m[2] ?? m[3] ?? "";
    if (isLocalName(v)) out.add(v);
  }
  for (const m of html.matchAll(SOUND)) out.add(decodeEntities(m[1]!));
  return [...out];
}

/**
 * Rewrites local media references in HTML or CSS (src/data attributes, url(…)) with `urlFor(name)`; names for
 * which it returns undefined are left as they are. For the app: replace names with object URLs of `getMedia` blobs.
 */
export function replaceMediaReferences(html: string, urlFor: (name: string) => string | undefined): string {
  const attr = html.replace(SRC_ATTR, (whole, attrName: string, dq?: string, sq?: string, bare?: string) => {
    const raw = dq ?? sq ?? bare ?? "";
    const name = decodeEntities(raw);
    if (!isLocalName(name)) return whole;
    const url = urlFor(name);
    return url === undefined ? whole : `${attrName}="${url.replace(/"/g, "&quot;")}"`;
  });
  return attr.replace(CSS_URL, (whole, dq?: string, sq?: string, bare?: string) => {
    const name = dq ?? sq ?? bare ?? "";
    if (!isLocalName(name)) return whole;
    const url = urlFor(name);
    return url === undefined ? whole : `url("${url}")`;
  });
}

