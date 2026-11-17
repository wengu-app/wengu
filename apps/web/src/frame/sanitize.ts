/**
 * DOM clean-up of card/field HTML, used in two places:
 *  - Wengu mode (inside the card frame): drop the deck's scripts and styling so the content takes Wengu's typography.
 *    This is for looks, not security; the frame is the security boundary.
 *  - The field editor (in the app page): field HTML from shared decks is untrusted, so anything active goes.
 */

const DROP_ELEMENTS = new Set([
  "SCRIPT", "STYLE", "LINK", "META", "BASE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "NOSCRIPT",
  "TEMPLATE", "APPLET", "PORTAL", "FENCEDFRAME",
]);
/** Elements replaced by their children. */
const UNWRAP_ELEMENTS = new Set(["FORM"]);

/** Inline style properties kept in Wengu mode (emphasis that carries meaning). Everything else is the deck's styling. */
const KEEP_STYLE = new Set(["font-weight", "font-style", "text-decoration", "text-decoration-line", "vertical-align", "color", "background-color", "direction", "unicode-bidi", "white-space"]);

const NAMED_NEUTRAL = new Set(["black", "white", "gray", "grey", "silver", "dimgray", "dimgrey", "darkgray", "darkgrey", "lightgray", "lightgrey", "gainsboro", "whitesmoke", "snow", "ivory", "transparent", "inherit", "initial", "currentcolor", "windowtext", "canvastext", "canvas"]);

function parseRgb(v: string): [number, number, number] | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
    if (h.length < 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** True for black/white/greys: colours that only make sense on the deck's own background and break dark mode. */
export function isNeutralColor(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s*!important$/, "");
  if (NAMED_NEUTRAL.has(v)) return true;
  const rgb = parseRgb(v);
  if (!rgb) return false;
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max - min < 28;
}

/** Keeps only meaningful inline styles; returns the new style attribute value ("" = remove). */
export function filterInlineStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!KEEP_STYLE.has(prop) || !value || /url\s*\(|expression\s*\(/i.test(value)) continue;
    if ((prop === "color" || prop === "background-color") && isNeutralColor(value)) continue;
    if (prop === "font-weight" && /^(normal|400)$/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

function isUnsafeUrl(v: string): boolean {
  return /^\s*(javascript|vbscript|data:text\/html)/i.test(v);
}

export interface CleanOptions {
  /** Wengu mode: also drop the deck's presentational markup (inline sizes/fonts, <font face>, classes stay). */
  restyle: boolean;
}

/** Cleans a parsed fragment in place. */
export function cleanTree(root: ParentNode, opts: CleanOptions): void {
  const walker: Element[] = [];
  const collect = (n: ParentNode) => {
    for (const c of Array.from(n.children)) walker.push(c);
  };
  collect(root);
  while (walker.length) {
    const el = walker.pop()!;
    const tag = el.tagName.toUpperCase();
    if (DROP_ELEMENTS.has(tag)) {
      el.remove();
      continue;
    }
    if (UNWRAP_ELEMENTS.has(tag)) {
      collect(el);
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "formaction" || name === "srcdoc") {
        el.removeAttribute(attr.name);
      } else if ((name === "href" || name === "src" || name === "action" || name === "xlink:href") && isUnsafeUrl(attr.value)) {
        el.removeAttribute(attr.name);
      } else if (opts.restyle) {
        if (name === "style") {
          const v = filterInlineStyle(attr.value);
          if (v) el.setAttribute("style", v);
          else el.removeAttribute("style");
        } else if (tag === "FONT" && (name === "face" || name === "size")) {
          el.removeAttribute(attr.name);
        } else if (tag === "FONT" && name === "color" && isNeutralColor(attr.value)) {
          el.removeAttribute(attr.name);
        } else if (name === "bgcolor" || name === "background" || (name === "align" && tag !== "TD" && tag !== "TH")) {
          el.removeAttribute(attr.name);
        } else if ((name === "width" || name === "height") && tag !== "IMG" && tag !== "SVG" && tag !== "VIDEO") {
          el.removeAttribute(attr.name);
        }
      }
    }
    collect(el);
  }
}

/** Parses HTML inertly (no scripts run, nothing loads) and cleans it. */
export function cleanHtml(html: string, opts: CleanOptions, doc: Document = document): DocumentFragment {
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  cleanTree(tpl.content, opts);
  return tpl.content;
}
