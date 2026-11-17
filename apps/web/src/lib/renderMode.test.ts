import { describe, expect, test } from "vitest";
import { analyseCss, analyseNoteType, decideMode, emphasisMap } from "./renderMode.ts";

const STOCK_CSS = `.card {\n font-family: arial;\n font-size: 20px;\n line-height: 1.5;\n text-align: center;\n color: black;\n background-color: white;\n}\n.cloze { font-weight: bold; color: blue; }\n.nightMode .cloze { color: lightblue; }`;
const tpl = (q: string, a = "{{FrontSide}}<hr id=answer>{{Back}}") => [{ ord: 0, name: "Card 1", questionFormat: q, answerFormat: a }];

describe("Wengu mode safety", () => {
  test("Anki's stock note types are safe", () => {
    expect(analyseNoteType({ templates: tpl("{{Front}}"), css: STOCK_CSS })).toEqual({ safe: true, reasons: [] });
    expect(analyseCss(".card { background: #fdfcf8; } .word { font-size: 40px; }")).toEqual([]);
  });
  test("scripts, handlers and layout CSS are not", () => {
    expect(analyseNoteType({ templates: tpl("{{Front}}<script>x()</script>"), css: "" }).reasons[0]).toEqual({ kind: "script" });
    expect(analyseNoteType({ templates: tpl('<div onclick="f()">{{Front}}</div>'), css: "" }).reasons[0]).toEqual({ kind: "handlers" });
    expect(analyseCss(".back { display: none }")).toEqual([{ kind: "css", props: ["display: none"] }]);
    expect(analyseCss(".a { position: absolute; top: 0 }")[0]).toMatchObject({ kind: "css" });
    expect(analyseCss(".a::before { content: 'x' }")[0]).toMatchObject({ kind: "css", props: ["content"] });
    expect(analyseCss("@font-face { font-family: X; src: url(_x.ttf) }")[0]).toEqual({ kind: "fontFace" });
    expect(analyseCss(".card { background: url(_bg.png) }")[0]).toEqual({ kind: "css", props: ["background-image"] });
    expect(analyseCss("/* display: none */ .a { color: red }")).toEqual([]);
  });
  test("decision honours the per-note-type switch and the default", () => {
    const safe = { safe: true, reasons: [] };
    const unsafe = { safe: false, reasons: [{ kind: "script" as const }] };
    expect(decideMode(safe, undefined, "auto", "x").mode).toBe("wengu");
    expect(decideMode(unsafe, undefined, "auto", "x")).toEqual({ mode: "original", reason: { kind: "script" } });
    expect(decideMode(unsafe, "wengu", "auto", "x").mode).toBe("wengu");
    expect(decideMode(safe, "original", "auto", "x")).toEqual({ mode: "original", reason: { kind: "forced" } });
    expect(decideMode(safe, undefined, "original", "x").mode).toBe("original");
    expect(decideMode(safe, undefined, "auto", "<script>1</script>")).toEqual({ mode: "original", reason: { kind: "fieldScript" } });
  });
});

test("deck classes map onto Wengu emphasis", () => {
  const css = `.card { font-size: 22px; color: #222; }\n.word { font-size: 40px; }\n.ex { color: #666; font-style: italic; }\n.tags { font-size: 12px; color: #999; }\n.nightMode .x { font-size: 8px }`;
  expect(emphasisMap(css)).toEqual({ word: ["wg-large"], ex: ["wg-muted", "wg-italic"], tags: ["wg-small", "wg-muted"] });
});
