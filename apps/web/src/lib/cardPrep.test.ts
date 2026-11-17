import { describe, expect, test } from "vitest";
import type { AnkiTemplatePresentation, NoteType } from "@wengu/core";
import { hasMath, prepareCard } from "./cardPrep.ts";
import { DICTS } from "./i18n.ts";
import { filterInlineStyle, isNeutralColor } from "../frame/sanitize.ts";

const nt: NoteType = {
  id: 1, name: "Basic (type)", kind: "normal", css: "", sortFieldIndex: 0, modifiedAt: 0,
  fields: ["Front", "Back"].map((name, ord) => ({ ord, name, rtl: false, fontName: "Arial", fontSize: 20, description: "", plainText: false, collapsed: false, sticky: false })),
  templates: [{ ord: 0, name: "Card 1", questionFormat: "{{Front}} {{type:Back}}", answerFormat: "{{Front}}<hr id=answer>{{type:Back}}" }],
};
const pres: AnkiTemplatePresentation = {
  kind: "anki-template", templateName: "Card 1", css: "", media: [], errors: [],
  question: "Q [anki:play:q:0] [[type:Back]]", answer: "Q<hr id=answer>[[type:Back]] [anki:play:a:0]",
  questionAvTags: [{ kind: "sound", filename: "a.mp3" }], answerAvTags: [{ kind: "sound", filename: "b.mp3" }],
};

describe("card preparation", () => {
  test("markers become elements; expected answer comes from the field", () => {
    const p = prepareCard({ presentation: pres, noteType: nt, analysis: { safe: true, reasons: [] }, fields: ["Q", "Paris &amp; co"], ord: 0, modeSetting: undefined, renderDefault: "auto", labels: { replay: "Play", typePlaceholder: "Type" } });
    expect(p.question).toContain('data-wg-play="q:0"');
    expect(p.question).toContain('<input id="typeans"');
    expect(p.answer).toContain('class="wg-typeans-result"');
    expect(p.answer).toContain('data-wg-play="a:0"');
    expect(p.expected).toBe("Paris & co");
    expect(p.decision.mode).toBe("wengu");
    expect(p.cardClass).toBe("card card1");
    expect(p.emphasis).toEqual({});
  });
  test("math detection", () => {
    expect(hasMath("Euler: \\(e^{i\\pi}\\)")).toBe(true);
    expect(hasMath('<img class=latex alt="x" src="latex-1.png">')).toBe(true);
    expect(hasMath("plain")).toBe(false);
  });
  test("Wengu-mode inline style filter keeps emphasis, drops the deck's fonts and greys", () => {
    expect(isNeutralColor("rgb(0, 0, 0)")).toBe(true);
    expect(isNeutralColor("#333")).toBe(true);
    expect(isNeutralColor("#c00")).toBe(false);
    expect(filterInlineStyle("font-family: Arial; font-size: 12px; color: rgb(0,0,0); font-weight: bold")).toBe("font-weight: bold");
    expect(filterInlineStyle("color: #c00; background-image: url(x.png)")).toBe("color: #c00");
  });
  test("both dictionaries have every string, with the same placeholders", () => {
    for (const [k, v] of Object.entries(DICTS.en)) {
      const zh = DICTS.zh[k as keyof typeof DICTS.en];
      expect(zh, k).toBeTruthy();
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(zh), k).toEqual(ph(v));
    }
  });
});
