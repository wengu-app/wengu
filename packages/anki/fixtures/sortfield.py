#!/usr/bin/env python3
"""Ask the official Anki library for the sort field (notes.sfld) and checksum
(notes.csum) of probe field values, for test/sortfield.test.ts.

    fixtures/.venv/bin/python fixtures/sortfield.py   # writes fixtures/expected/sort-fields.json

No clock control is needed: sfld/csum depend only on the field text.
"""

from __future__ import annotations

import html.entities
import json
import os
import shutil
import tempfile
from pathlib import Path

from anki.collection import Collection
import anki.buildinfo

OUT = Path(__file__).resolve().parent / "expected" / "sort-fields.json"

CASES = [
    "plain", "  lead and trail  ", "<b>bold</b> text", 'img <img src="a b.png"> after', "<img src='single.jpg'>",
    "<img src=noquote.gif>", '<img alt="x" src="k&amp;v.png" width=3>',
    "A &amp; B &lt;3 &gt; &quot;q&quot; &#39;s &nbsp;nb &#x4e2d; &copy;", "line<br>break<br/>x<div>d</div>",
    "<!-- comment -->visible", "<style>.x{}</style>after style", "<script>var a=1</script>after script",
    "[sound:hello.mp3] text", "123", "  42 ", "-7", "3.5", "007", "1e3", "+5", ".5", "5.", "0x10",
    "🎉👨‍👩‍👧 emoji", "中文<i>斜</i>体", "\n\tnewline\ttab\n", '<audio src="snd.mp3"></audio>', '<video src="v.mp4"></video>',
    "x < y and y > z", "<<b>>", "&amp;amp;", "&unknown; entity", '<IMG SRC="UP.PNG">', '<object data="o.svg"></object>',
    "", "<br>", "&nbsp;", "Ａ fullwidth", '<span style="color: red">red</span>', "a b literal",
    "&#160;x &#xA0;y &#xa0;z", "&NBSP; caps", '<a title="a>b">x</a>', "<STYLE>p{}</STYLE>up", '<img src="a.png"/>',
    '<img data-src="d.png">', '<img src="">e', "<img>", "<!-- a > b -->c",
    "&eacute;&Eacute;&hellip;&mdash;&euro;&rarr;&lsquo;&trade;&alpha;&nbsp", "&#0; &#99999999; &#x110000;",
    '<source src="s.mp3">', '<embed src="e.swf">', '<iframe src="f.html"></iframe>', '<img src="a.png"><img src="b.png">',
    "&lt;b&gt;not a tag&lt;/b&gt;", "a&ampb", "&#65;&#x42;", '<img src="x.png" src="y.png">', '<img\nsrc="nl.png">',
    '<img src = "sp.png">', "&amp;lt;", "&lowast;&loz;&spades;&OElig;&fnof;&thetasym;&lang;&rang;&apos;",
    "&NotEqualTilde;&bigstar;", "A & B &amp; C", "&amp; &bigstar;", "&amp; &#X41;", "&amp; &#xD800;", "&amp;&",
    "&amp; a&b", "&amp; &;", "&amp; &1;", "&amp; &#;", "&amp; &AMP;", "&amp; &nbsp", "&amp; &#65x;", "&amp; &#0;",
    "&amp; &#x110000;", "&amp; &#00000000065;", "&amp; &#x0000041;", "&amp; &copy;x", "&nbsp;&nbsp;", "&nbsp; &bad;",
    '<img src="a&b.png"> &amp;', '<audio src="x.mp3" /> <video src="v"></video><source src=s.ogg><object data="o.svg">',
    "<b\n>multi\nline</b\n>", "<!---->x<!-- unterminated", "<style>a</style>b<style>c</style>d",
    '<script src="x.js"></script>s', "&#128512; &#9; &#127; &#150; &#xFFFE;",
]
# Every HTML 4 entity and a sample of HTML5-only ones, one per field.
CASES += [f"x&{name};y" for name in sorted(html.entities.name2codepoint)]
CASES += [f"x&{name}y" for name in ("bigstar;", "apos;", "NotEqualTilde;", "amp", "nbsp")]


def main() -> None:
    d = tempfile.mkdtemp(prefix="wengu-sfld-")
    try:
        col = Collection(os.path.join(d, "collection.anki2"))
        basic = col.models.by_name("Basic")
        # Second notetype whose sort field is not the first field, to tell sfld and csum apart.
        rev = col.models.copy(basic, add=False)
        rev["name"] = "Basic sort-by-back"
        rev["sortf"] = 1
        col.models.add(rev)
        rev = col.models.by_name("Basic sort-by-back")
        out = []
        for i, case in enumerate(CASES):
            m = basic if i % 2 == 0 else rev
            n = col.new_note(m)
            n["Front"] = case
            n["Back"] = case if m is basic else f"<i>back</i> {case}"
            col.add_note(n, 1)
            flds, sfld, csum = col.db.first("select flds, sfld, csum from notes where id = ?", n.id)
            out.append({"fields": flds.split("\x1f"), "sortf": m["sortf"], "sfld": sfld, "csum": csum})
        col.close()
    finally:
        shutil.rmtree(d, ignore_errors=True)
    OUT.write_text(json.dumps({"ankiVersion": anki.buildinfo.version, "cases": out}, ensure_ascii=False, indent=1) + "\n")
    print("wrote", OUT, len(out))


if __name__ == "__main__":
    main()
