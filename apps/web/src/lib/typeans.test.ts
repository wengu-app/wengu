import { describe, expect, test } from "vitest";
import { clozeAnswers, compareAnswer, expectedAnswer, htmlToPlain, parseTypeSpec } from "./typeans.ts";

describe("type in the answer", () => {
  test("spec parsing", () => {
    expect(parseTypeSpec("Back")).toEqual({ field: "Back", cloze: false, nc: false });
    expect(parseTypeSpec("cloze:Text")).toEqual({ field: "Text", cloze: true, nc: false });
    expect(parseTypeSpec("nc:Word")).toEqual({ field: "Word", cloze: false, nc: true });
  });
  test("field html to typed text", () => {
    expect(htmlToPlain("A cat 🐱 &amp; friends &lt;3")).toBe("A cat 🐱 & friends <3");
    expect(htmlToPlain("<b>Paris</b><br>France&nbsp;")).toBe("Paris France");
  });
  test("cloze answers, with hints and nesting", () => {
    expect(clozeAnswers("{{c1::北京}}是中国的{{c2::首都::capital}}。", 2)).toEqual(["首都"]);
    expect(clozeAnswers("{{c1::outer {{c2::inner}} text}} then {{c3::a}} and {{c3::b}}", 1)).toEqual(["outer inner text"]);
    expect(clozeAnswers("{{c1::outer {{c2::inner}} text}} then {{c3::a}} and {{c3::b}}", 3)).toEqual(["a", "b"]);
    expect(expectedAnswer({ field: "Text", cloze: true, nc: false }, { Text: "{{c3::a}} and {{c3::b}}" }, 2)).toBe("a, b");
  });
  test("comparison", () => {
    expect(compareAnswer("Paris", "Paris")).toEqual({ correct: true, html: '<span class="typeGood">Paris</span>' });
    const c = compareAnswer("Pari", "Paris");
    expect(c.correct).toBe(false);
    expect(c.html).toContain('<span class="typeGood">Pari</span><span class="typeArrow"');
    expect(c.html).toContain('<span class="typeMissed">s</span>');
    expect(compareAnswer("Parxs", "Paris").html).toContain('<span class="typeBad">x</span>');
    expect(compareAnswer("", "<b>").html).toBe('<span class="typeMissed">&lt;b&gt;</span>');
    expect(compareAnswer("cafe", "café", true).correct).toBe(true);
    expect(compareAnswer("cafe", "café", false).correct).toBe(false);
  });
});
