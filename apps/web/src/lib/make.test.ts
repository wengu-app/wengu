import { describe, expect, it } from "vitest";
import type { NoteType } from "@wengu/core";

import { cardCount, defaultPinnedIds, isBlank, isImageOcclusion, partitionNoteTypes, sides, transferFields } from "./make.ts";

const nt = (partial: Partial<NoteType> & Pick<NoteType, "name" | "kind" | "fields" | "templates">): NoteType => ({
  id: 1,
  css: "",
  sortFieldIndex: 0,
  modifiedAt: 0,
  ...partial,
});

const f = (name: string, ord: number) => ({
  name,
  ord,
  rtl: false,
  fontName: "Arial",
  fontSize: 20,
  description: "",
  plainText: false,
  collapsed: false,
  sticky: false,
});

describe("Make helpers", () => {
  it("detects Anki Image Occlusion note types from templates", () => {
    const io = nt({
      name: "Image Occlusion",
      kind: "cloze",
      fields: [f("Occlusion", 0), f("Image", 1), f("Header", 2)],
      templates: [{ name: "Image Occlusion", ord: 0, questionFormat: "{{Image}}<script>anki.imageOcclusion.setup()</script>", answerFormat: "" }],
    });
    const cloze = nt({
      name: "Cloze",
      kind: "cloze",
      fields: [f("Text", 0), f("Back Extra", 1)],
      templates: [{ name: "Cloze", ord: 0, questionFormat: "{{cloze:Text}}", answerFormat: "{{cloze:Text}}{{Back Extra}}" }],
    });
    expect(isImageOcclusion(io)).toBe(true);
    expect(isImageOcclusion(cloze)).toBe(false);
  });

  it("treats embedded media as non-blank", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("  <br>&nbsp; ")).toBe(true);
    expect(isBlank('<img src="cat.png">')).toBe(false);
    expect(isBlank("[sound:clip.mp3]")).toBe(false);
    expect(isBlank("hello")).toBe(false);
  });

  it("estimates card count accurately for conditional templates and cloze", () => {
    const optRev = nt({
      name: "Basic (optional reversed card)",
      kind: "normal",
      fields: [f("Front", 0), f("Back", 1), f("Add Reverse", 2)],
      templates: [
        { name: "Card 1", ord: 0, questionFormat: "{{Front}}", answerFormat: "{{Back}}" },
        { name: "Card 2", ord: 1, questionFormat: "{{#Add Reverse}}{{Back}}{{/Add Reverse}}", answerFormat: "{{Front}}" },
      ],
    });
    expect(cardCount(optRev, ["", "", ""])).toBe(0);
    expect(cardCount(optRev, ["Q", "A", ""])).toBe(1);
    expect(cardCount(optRev, ["Q", "A", "y"])).toBe(2);
    expect(cardCount(optRev, ['<img src="x.png">', "A", ""])).toBe(1);

    const cloze = nt({
      name: "Cloze",
      kind: "cloze",
      fields: [f("Text", 0), f("Back Extra", 1)],
      templates: [{ name: "Cloze", ord: 0, questionFormat: "{{cloze:Text}}", answerFormat: "{{cloze:Text}}" }],
    });
    expect(cardCount(cloze, ["plain text", ""])).toBe(0);
    expect(cardCount(cloze, ["{{c1::a}} and {{c2::b}} and {{c1::c}}", ""])).toBe(2);
  });

  it("preserves draft fields when switching note types", () => {
    const basic = nt({
      name: "Basic",
      kind: "normal",
      fields: [f("Front", 0), f("Back", 1)],
      templates: [{ name: "Card 1", ord: 0, questionFormat: "{{Front}}", answerFormat: "{{Back}}" }],
    });
    const cloze = nt({
      name: "Cloze",
      kind: "cloze",
      fields: [f("Text", 0), f("Back Extra", 1)],
      templates: [{ name: "Cloze", ord: 0, questionFormat: "{{cloze:Text}}", answerFormat: "{{cloze:Text}}" }],
    });
    expect(transferFields(basic, ["Q", "A"], cloze)).toEqual(["Q", "A"]);
    expect(transferFields(basic, ["", ""], cloze)).toEqual(["", ""]);
    expect(sides(basic)).toEqual({ front: [0], back: [1] });
  });

  it("pins the most commonly used supported note types by default and keeps an unpinned active type visible", () => {
    const basic = nt({ id: 1, name: "Basic", kind: "normal", fields: [f("Front", 0)], templates: [{ name: "C1", ord: 0, questionFormat: "{{Front}}", answerFormat: "" }] });
    const rev = nt({ id: 2, name: "Basic (and reversed card)", kind: "normal", fields: [f("Front", 0)], templates: [{ name: "C1", ord: 0, questionFormat: "{{Front}}", answerFormat: "" }] });
    const cloze = nt({ id: 3, name: "Cloze", kind: "cloze", fields: [f("Text", 0)], templates: [{ name: "Cloze", ord: 0, questionFormat: "{{cloze:Text}}", answerFormat: "" }] });
    const vocab = nt({ id: 4, name: "Vocab", kind: "normal", fields: [f("Word", 0)], templates: [{ name: "C1", ord: 0, questionFormat: "{{Word}}", answerFormat: "" }] });
    const io = nt({ id: 5, name: "Image Occlusion", kind: "cloze", fields: [f("Occlusion", 0)], templates: [{ name: "IO", ord: 0, questionFormat: "<script>anki.imageOcclusion.setup()</script>", answerFormat: "" }] });
    const all = [basic, rev, cloze, vocab, io];

    const counts = new Map([
      [1, 12],
      [2, 2],
      [3, 5],
      [4, 20],
      [5, 50], // unsupported: excluded from default pins
    ]);
    const pinned = defaultPinnedIds(all, counts);
    expect(pinned).toEqual([4, 1, 3]);

    const part = partitionNoteTypes(all, pinned, 2);
    expect(part.visible.map((x) => x.id)).toEqual([1, 3, 4, 2]);
    expect(part.hasMore).toBe(true);
    expect(part.pinnedSet.has(2)).toBe(false);
  });
});
