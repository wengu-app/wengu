#!/usr/bin/env python3
"""Generate .apkg/.colpkg test fixtures with the official Anki library.

Everything in fixtures/apkg/ is written by Anki itself, and everything in
fixtures/expected/ is Anki's own answer about those files (counts, field
values, rendered HTML, FSRS memory state, next intervals, fuzz).  The
TypeScript tests compare against these answers.

Review history must be genuine, which means the scheduler has to see time
pass.  The Anki backend (Rust) reads the system clock, so the script re-execs
itself under libfaketime and moves the clock by rewriting a timestamp file.

Usage (from packages/anki):
    python3 -m venv fixtures/.venv            # or --without-pip + get-pip.py
    fixtures/.venv/bin/pip install anki==26.9.4
    LIBFAKETIME=/path/to/libfaketime.so.1 fixtures/.venv/bin/python fixtures/generate.py

If libfaketime is not installed system-wide, it can be fetched without root:
    apt download libfaketime && dpkg -x libfaketime_*.deb ft
    export LIBFAKETIME=$PWD/ft/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1
"""

from __future__ import annotations

import base64
import calendar
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
APKG_DIR = HERE / "apkg"
EXPECTED_DIR = HERE / "expected"

# Simulated wall clock.  TZ is forced to UTC, the rollover hour stays at
# Anki's default (4), so a "day" starts at 04:00 UTC.
START = "2025-03-01 09:00:00"


# ---------------------------------------------------------------------------
# libfaketime bootstrap
# ---------------------------------------------------------------------------

FT_CANDIDATES = [
    "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1",
    "/usr/lib/aarch64-linux-gnu/faketime/libfaketime.so.1",
    "/usr/lib/faketime/libfaketime.so.1",
    "/usr/local/lib/faketime/libfaketime.so.1",
    "/opt/homebrew/lib/faketime/libfaketime.1.dylib",
]


def ensure_faketime() -> Path:
    """Re-exec under libfaketime; return the timestamp file path."""
    if os.environ.get("WENGU_FT_ACTIVE") == "1":
        return Path(os.environ["FAKETIME_TIMESTAMP_FILE"])
    lib = os.environ.get("LIBFAKETIME")
    if not lib:
        lib = next((c for c in FT_CANDIDATES if os.path.exists(c)), None)
    if not lib or not os.path.exists(lib):
        sys.exit(
            "libfaketime not found; set LIBFAKETIME=/path/to/libfaketime.so.1 "
            "(see the docstring at the top of this file)"
        )
    ts_file = Path(tempfile.mkdtemp(prefix="wengu-ft-")) / "now"
    ts_file.write_text(START + "\n")
    env = dict(os.environ)
    env.update(
        WENGU_FT_ACTIVE="1",
        LD_PRELOAD=lib,
        DYLD_INSERT_LIBRARIES=lib,
        FAKETIME_TIMESTAMP_FILE=str(ts_file),
        FAKETIME_NO_CACHE="1",
        TZ="UTC",
    )
    r = subprocess.run([sys.executable, *sys.argv], env=env)
    shutil.rmtree(ts_file.parent, ignore_errors=True)
    sys.exit(r.returncode)


TS_FILE = ensure_faketime()

# Only import anki once the clock is under our control.
from anki.collection import Collection  # noqa: E402
from anki.config import Config  # noqa: E402
from anki.import_export_pb2 import (  # noqa: E402
    ExportAnkiPackageOptions,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from anki.scheduler_pb2 import CardAnswer  # noqa: E402
from anki.deck_config_pb2 import UPDATE_DECK_CONFIGS_MODE_NORMAL  # noqa: E402
import anki.buildinfo  # noqa: E402


def epoch(s: str) -> int:
    return calendar.timegm(time.strptime(s, "%Y-%m-%d %H:%M:%S"))


_now = epoch(START)


def set_now(t: int) -> None:
    global _now
    _now = t
    tmp = TS_FILE.with_suffix(".tmp")
    tmp.write_text(time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t)) + "\n")
    os.replace(tmp, TS_FILE)
    assert abs(int(time.time()) - t) <= 1, "faketime is not active"


def tick(seconds: int = 1) -> None:
    set_now(_now + seconds)


# ---------------------------------------------------------------------------
# tiny media files (generated, so the fixtures stay small)
# ---------------------------------------------------------------------------


def tiny_png(red: int = 200) -> bytes:
    w = h = 4
    rows = b""
    for y in range(h):
        rows += b"\x00" + b"".join(bytes([red, 40 * y, 50 * x]) for x in range(w))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def tiny_wav() -> bytes:
    rate, n = 8000, 400
    data = bytes(128 + (20 if (i // 10) % 2 else -20) for i in range(n))
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate, 1, 8)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


# ---------------------------------------------------------------------------
# collection contents
# ---------------------------------------------------------------------------

CUSTOM_CSS = """.card {
  font-family: "Noto Sans CJK SC", sans-serif;
  font-size: 22px;
  text-align: center;
  color: #222;
  background: #fdfcf8;
}
.word { font-size: 40px; }
.ex { color: #666; font-style: italic; }
.tags { font-size: 12px; color: #999; }
"""

# FSRS-6 parameters for the custom preset.  Deliberately not the defaults so
# the importer/parity code must actually read them from the file.
CUSTOM_FSRS6 = [
    0.3, 1.5, 3.0, 10.0, 6.0, 0.9, 2.8, 0.01, 1.7, 0.2, 0.9,
    1.6, 0.07, 0.3, 1.5, 0.5, 2.0, 0.5, 0.1, 0.07, 0.2,
]
# A preset that only has FSRS-5 (19) parameters, as written by Anki 24.11.
LEGACY_FSRS5 = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
    0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]


def add_note(col: Collection, notetype: str, deck: int, fields: dict[str, str], tags: list[str]) -> int:
    m = col.models.by_name(notetype)
    assert m, notetype
    n = col.new_note(m)
    for k, v in fields.items():
        n[k] = v
    n.tags = tags
    col.add_note(n, deck)
    tick()
    return n.id


def make_custom_notetype(col: Collection) -> None:
    mm = col.models
    m = mm.new("Wengu Vocab 词汇")
    for name in ["Word", "Reading", "Meaning", "Example", "Audio", "Picture", "Notes"]:
        mm.add_field(m, mm.new_field(name))
    t = mm.new_template("Recognition")
    t["qfmt"] = '<div class="word">{{Word}}</div>\n{{#Picture}}<div class="pic">{{Picture}}</div>{{/Picture}}'
    t["afmt"] = (
        "{{FrontSide}}\n<hr id=answer>\n{{furigana:Reading}}<br>\n{{Meaning}}\n"
        '{{#Example}}<div class="ex">{{Example}}</div>{{/Example}}\n'
        "{{^Notes}}<i>no notes</i>{{/Notes}}{{#Notes}}{{hint:Notes}}{{/Notes}}\n"
        '<div class="tags">{{Tags}} | {{Deck}} | {{Subdeck}} | {{Card}} | {{Type}}</div>'
    )
    mm.add_template(m, t)
    t = mm.new_template("Production")
    t["qfmt"] = "{{Meaning}}<br>\n{{type:Word}}"
    t["afmt"] = "{{FrontSide}}\n<hr id=answer>\n{{Word}} — {{text:Example}} {{kana:Reading}}"
    mm.add_template(m, t)
    t = mm.new_template("Listening")
    t["qfmt"] = "{{#Audio}}🔊 {{Audio}}{{/Audio}}"
    t["afmt"] = "{{FrontSide}}\n<hr id=answer>\n{{Word}} {{kanji:Reading}}"
    mm.add_template(m, t)
    m["css"] = CUSTOM_CSS
    mm.add(m)
    tick()

    # A cloze notetype exercising cloze conditionals, type:cloze, tts and
    # cloze-only, text: entity decoding and {{CardFlag}}.
    c = mm.copy(mm.by_name("Cloze"), add=False)
    c["name"] = "Wengu Cloze+"
    c["tmpls"][0]["qfmt"] = (
        "{{cloze:Text}}{{#c2}}<i>has c2</i>{{/c2}}{{^c2}}<i>no c2</i>{{/c2}}\n{{type:cloze:Text}}\n"
        "{{tts en_US voices=Apple_Samantha speed=1.1:cloze-only:Text}}"
    )
    c["tmpls"][0]["afmt"] = "{{cloze:Text}}\n{{text:Back Extra}}|{{ Back Extra }}|{{CardFlag}}"
    mm.add(c)
    tick()


def setup_presets(col: Collection, decks: dict[str, int]) -> dict[str, int]:
    """Enable FSRS and create presets via the same API the deck options screen uses."""
    col.set_config_bool(Config.Bool.LOAD_BALANCER_ENABLED, False)

    def update(target: int, configs, fsrs: bool = True, deck_retention: float | None = None) -> None:
        cur = col.decks.get_deck_configs_for_update(target)
        limits = cur.current_deck.limits
        if deck_retention is not None:
            limits.desired_retention = deck_retention
        col._backend.update_deck_configs(
            target_deck_id=target,
            configs=configs,
            removed_config_ids=[],
            mode=UPDATE_DECK_CONFIGS_MODE_NORMAL,
            card_state_customizer="",
            limits=limits,
            new_cards_ignore_review_limit=False,
            fsrs=fsrs,
            apply_all_parent_limits=False,
            fsrs_reschedule=False,
            fsrs_health_check=False,
        )
        tick()

    # Default preset: FSRS on, default parameters (empty param lists).
    cur = col.decks.get_deck_configs_for_update(decks["root"])
    default = next(c.config for c in cur.all_config if c.config.id == 1)
    default.config.desired_retention = 0.9
    update(decks["root"], [default])

    # Custom preset with FSRS-6 params on the Science subtree.
    cur = col.decks.get_deck_configs_for_update(decks["math"])
    custom = type(default)()
    custom.CopyFrom(default)
    custom.id = 0
    custom.name = "Custom FSRS-6 预设"
    del custom.config.fsrs_params_6[:]
    custom.config.fsrs_params_6.extend(CUSTOM_FSRS6)
    custom.config.desired_retention = 0.85
    del custom.config.learn_steps[:]
    custom.config.learn_steps.extend([2.0, 15.0, 60.0])
    del custom.config.relearn_steps[:]
    custom.config.relearn_steps.extend([5.0])
    custom.config.maximum_review_interval = 365
    custom.config.new_per_day = 30
    update(decks["math"], [custom])

    # Preset with FSRS-5 parameters only, on the Japanese deck.
    legacy = type(default)()
    legacy.CopyFrom(default)
    legacy.id = 0
    legacy.name = "Legacy FSRS-5"
    del legacy.config.fsrs_params_5[:]
    legacy.config.fsrs_params_5.extend(LEGACY_FSRS5)
    legacy.config.desired_retention = 0.92
    update(decks["ja"], [legacy])
    # update_deck_configs() silently drops FSRS-5-only parameters (verified
    # with Anki 26.09), so store them through the legacy dict API instead.
    conf = col.decks.config_dict_for_deck_id(decks["ja"])
    conf["fsrsParams5"] = LEGACY_FSRS5
    col.decks.save(conf)
    tick()

    # Deck-level desired retention override on the Misc deck (default preset).
    cur = col.decks.get_deck_configs_for_update(decks["misc"])
    update(decks["misc"], [next(c.config for c in cur.all_config if c.config.id == 1)], deck_retention=0.8)

    by_name = {c["name"]: c["id"] for c in col.decks.all_config()}
    return by_name


def build_collection(path: str) -> tuple[Collection, dict]:
    set_now(epoch(START))
    col = Collection(path)
    make_custom_notetype(col)

    decks = {}
    for key, name in [
        ("root", "Wengu Test"),
        ("zh", "Wengu Test::Languages::中文"),
        ("ja", "Wengu Test::Languages::日本語"),
        ("math", "Wengu Test::Science::Math ∑"),
        ("misc", "Wengu Test::Misc"),
    ]:
        decks[key] = col.decks.id(name)
        tick()
    d = col.decks.get(decks["misc"])
    d["desc"] = "Deck with a <b>description</b> and a retention override."
    col.decks.save(d)
    tick()

    presets = setup_presets(col, decks)

    media = col.media
    img = media.write_data("猫 cat.png", tiny_png())
    snd = media.write_data("hello-你好.wav", tiny_wav())
    img2 = media.write_data("diagram.png", tiny_png(red=20))
    tick()

    n = {}
    n["basic"] = add_note(col, "Basic", decks["root"], {
        "Front": "What is the <b>capital</b> of France?",
        "Back": "Paris",
    }, ["geo", "marked"])
    n["basic_img"] = add_note(col, "Basic", decks["misc"], {
        "Front": f'Which animal? <img src="{img}">',
        "Back": "A cat 🐱 &amp; friends &lt;3",
    }, ["animals", "media::image"])
    n["basic_rev"] = add_note(col, "Basic (and reversed card)", decks["zh"], {
        "Front": "你好",
        "Back": "hello",
    }, ["lang::zh", "测试"])
    n["opt_rev_on"] = add_note(col, "Basic (optional reversed card)", decks["zh"], {
        "Front": "谢谢", "Back": "thank you", "Add Reverse": "y",
    }, ["lang::zh"])
    n["opt_rev_off"] = add_note(col, "Basic (optional reversed card)", decks["zh"], {
        "Front": "再见", "Back": "goodbye", "Add Reverse": "",
    }, ["lang::zh"])
    n["type_ans"] = add_note(col, "Basic (type in the answer)", decks["ja"], {
        "Front": "「ありがとう」 in English?", "Back": "thank you",
    }, ["lang::ja"])
    n["cloze_zh"] = add_note(col, "Cloze", decks["zh"], {
        "Text": "{{c1::北京}}是中国的{{c2::首都::capital}}。",
        "Back Extra": "Beijing 🇨🇳",
    }, ["lang::zh", "cloze"])
    n["cloze_math"] = add_note(col, "Cloze", decks["math"], {
        "Text": r"Euler: {{c1::\(e^{i\pi}+1=0\)}} and {{c2::\[\int_0^1 x\,dx = \tfrac12\]::integral}}",
        "Back Extra": r"Inline MathJax \(a^2+b^2=c^2\)",
    }, ["math"])
    n["cloze_nested"] = add_note(col, "Cloze", decks["math"], {
        "Text": "{{c1::outer {{c2::inner}} text}} then {{c3::a}} and {{c3::b}}",
        "Back Extra": "",
    }, ["math", "cloze::nested"])
    n["latex"] = add_note(col, "Basic", decks["math"], {
        "Front": r"LaTeX: [latex]\frac{a}{b}[/latex] and [$]x^2[/$]",
        "Back": r"[$$]\sum_{i=1}^n i[/$$]",
    }, ["math", "latex"])
    n["vocab_full"] = add_note(col, "Wengu Vocab 词汇", decks["ja"], {
        "Word": "猫",
        "Reading": "猫[ねこ]",
        "Meaning": "cat",
        "Example": "<b>猫</b>が好きです。",
        "Audio": f"[sound:{snd}]",
        "Picture": f'<img src="{img2}">',
        "Notes": "Common pet 😺",
    }, ["lang::ja", "vocab"])
    n["vocab_min"] = add_note(col, "Wengu Vocab 词汇", decks["ja"], {
        "Word": "犬",
        "Reading": "犬[いぬ]",
        "Meaning": "dog",
        "Example": "",
        "Audio": "",
        "Picture": "",
        "Notes": "",
    }, ["lang::ja", "vocab"])
    n["cloze_edge"] = add_note(col, "Wengu Cloze+", decks["math"], {
        "Text": r"MathJax \(x + {{c1::y^2}}\) and {{c2::A &amp; B<br>}} and <b>{{c1::bold::h<i>i</i>nt}}</b>",
        "Back Extra": "<div>x &lt; y &amp;&nbsp;z</div>",
    }, ["cloze::edge"])
    n["emoji"] = add_note(col, "Basic", decks["misc"], {
        "Front": "Emoji 🎉👨‍👩‍👧 and RTL שלום",
        "Back": "ZWJ sequence &nbsp; non-breaking",
    }, [])
    return col, {"decks": decks, "notes": n, "presets": presets}


def card_of(col: Collection, nid: int, ord_: int = 0):
    for c in col.get_note(nid).cards():
        if c.ord == ord_:
            return c
    raise KeyError((nid, ord_))


# ---------------------------------------------------------------------------
# review simulation
# ---------------------------------------------------------------------------

# Each script is a list of (rating, extra_days_late).  Ratings: 1 again,
# 2 hard, 3 good, 4 easy.  Learning-step answers happen when the step is
# due; review answers happen on the due day plus `late` days, at 10:00 plus a
# per-card offset.  A negative `late` means reviewing early.
SCRIPTS = {
    ("basic", 0): [(3, 0), (3, 0), (3, 0), (3, 0), (3, 0), (3, 0)],
    ("basic_rev", 0): [(1, 0), (3, 0), (3, 0), (3, 0), (1, 0), (3, 0), (3, 2), (2, 0), (4, 0)],
    ("basic_rev", 1): [(4, 0), (3, 0), (3, 5), (4, 0)],
    ("cloze_zh", 0): [(3, 0), (3, 0), (2, 0), (2, 0), (3, 0), (1, 0), (1, 0), (3, 0), (3, 0), (3, 0)],
    ("cloze_math", 0): [(3, 0), (3, 0), (3, 0), (3, 0), (1, 0), (3, 0), (3, 0)],
    ("cloze_math", 1): [(2, 0), (3, 0), (3, 0), (4, -2), (3, 0)],
    # Ends with a lapse, so the card is exported mid-relearning.
    ("type_ans", 0): [(3, 0), (3, 0), (3, 0), (1, 0), (3, 0), (3, 0), (1, 0)],
    # Answered once with Again: exported as a learning card.
    ("vocab_min", 0): [(1, 0)],
    ("vocab_full", 0): [(1, 0), (1, 0), (3, 0), (3, 0), (3, 0), (3, 0), (3, 1)],
    ("basic_img", 0): [(3, 0), (3, 0), (3, 0), (3, 0)],
}


def simulate(col: Collection, notes: dict[str, int]) -> int:
    start_day = epoch(START) - epoch(START) % 86400  # 00:00 UTC of day 0
    pending = []  # (time, seq, cid, script index)
    seq = 0
    for i, ((key, ord_), script) in enumerate(SCRIPTS.items()):
        cid = card_of(col, notes[key], ord_).id
        pending.append([start_day + 10 * 3600 + i * 120, seq, cid, 0, script, i])
        seq += 1
    last = epoch(START)
    while pending:
        pending.sort()
        ev = pending.pop(0)
        t, _, cid, idx, script, i = ev
        t = max(t, last + 1)
        set_now(t)
        last = t
        card = col.get_card(cid)
        rating, _late = script[idx]
        card.start_timer()
        states = col._backend.get_scheduling_states(cid)
        ans = col.sched.build_answer(card=card, states=states, rating=rating - 1)  # proto enum is 0-based
        ans.milliseconds_taken = 3000 + 700 * idx + 211 * i
        col.sched.answer_card(ans)
        idx += 1
        if idx >= len(script):
            continue
        card = col.get_card(cid)
        late = script[idx][1]
        if card.queue == 1:  # intraday learning: due is a unix timestamp
            nt = card.due + 15
        else:  # review / interday learning: due is a day number
            day = card.due + late
            nt = epoch_for_day(col, day) + 10 * 3600 - 4 * 3600 + i * 120
        pending.append([nt, seq, cid, idx, script, i])
        seq += 1
    return last


def epoch_for_day(col: Collection, day: int) -> int:
    """Unix time at the start (rollover) of scheduler day `day`."""
    return col.crt + day * 86400


# ---------------------------------------------------------------------------
# ground-truth dump
# ---------------------------------------------------------------------------


def state_dict(s) -> dict:
    """Flatten a SchedulingState protobuf into plain JSON."""
    kind = s.WhichOneof("kind")
    inner = getattr(s, kind)
    if kind == "normal":
        k2 = inner.WhichOneof("kind")
        st = getattr(inner, k2)
        out = {"kind": k2}
    else:
        k2 = inner.WhichOneof("kind")
        st = getattr(inner, k2)
        out = {"kind": "filtered:" + k2}
    for f in ("scheduled_days", "elapsed_days", "remaining_steps", "scheduled_secs", "elapsed_secs", "ease_factor", "lapses", "leeched"):
        if hasattr(st, f):
            v = getattr(st, f)
            out[f] = round(v, 6) if isinstance(v, float) else v
    if k2 == "relearning":
        out["review"] = {
            "scheduled_days": st.review.scheduled_days,
            "elapsed_days": st.review.elapsed_days,
            "lapses": st.review.lapses,
        }
        ms_holder = st.learning
        out["learning_scheduled_secs"] = st.learning.scheduled_secs
    else:
        ms_holder = st
    if ms_holder.HasField("memory_state") if hasattr(ms_holder, "memory_state") else False:
        out["memory_state"] = {
            "stability": ms_holder.memory_state.stability,
            "difficulty": ms_holder.memory_state.difficulty,
        }
    return out


def rows(col: Collection, sql: str) -> list[list]:
    return [list(r) for r in col.db.all(sql)]


def dump(col: Collection, *, scheduling: bool, now: int) -> dict:
    set_now(now)
    out: dict = {
        "ankiVersion": anki.buildinfo.version,
        "now": now,
        "crt": col.crt,
        "today": col.sched.today,
        "rolloverHour": col.get_config("rollover", 4),
        "fsrsEnabled": bool(col.get_config("fsrs", False)),
        "counts": {
            "notes": col.note_count(),
            "cards": col.card_count(),
            "revlog": col.db.scalar("select count() from revlog"),
            "notetypes": len(col.models.all_names_and_ids()),
            "decks": len(col.decks.all_names_and_ids()),
            "deckConfigs": len(col.decks.all_config()),
            "media": len(os.listdir(col.media.dir())),
        },
        "tags": sorted(col.tags.all()),
        "decks": [],
        "deckConfigs": [],
        "notetypes": [],
        "notes": [],
        "cards": [],
        "revlog": rows(col, "select id, cid, usn, ease, ivl, lastIvl, factor, time, type from revlog order by id"),
        "media": {},
    }
    for d in sorted(col.decks.all(), key=lambda d: d["name"]):
        out["decks"].append({
            "id": d["id"], "name": d["name"], "dyn": bool(d["dyn"]),
            "conf": d.get("conf"), "desc": d.get("desc", ""),
            "desiredRetention": d.get("desiredRetention"),
        })
    for c in sorted(col.decks.all_config(), key=lambda c: c["id"]):
        out["deckConfigs"].append({
            "id": c["id"], "name": c["name"],
            "learnSteps": c["new"]["delays"], "relearnSteps": c["lapse"]["delays"],
            "newPerDay": c["new"]["perDay"], "reviewsPerDay": c["rev"]["perDay"],
            "maxIvl": c["rev"]["maxIvl"], "desiredRetention": round(c["desiredRetention"], 6),
            "fsrsParams4": [round(x, 6) for x in c.get("fsrsWeights", [])],
            "fsrsParams5": [round(x, 6) for x in c.get("fsrsParams5", [])],
            "fsrsParams6": [round(x, 6) for x in c.get("fsrsParams6", [])],
        })
    for m in sorted(col.models.all(), key=lambda m: m["name"]):
        out["notetypes"].append({
            "id": m["id"], "name": m["name"], "type": m["type"], "css": m["css"],
            "sortf": m["sortf"], "latexPre": m["latexPre"], "latexPost": m["latexPost"],
            "fields": [f["name"] for f in m["flds"]],
            "templates": [{"name": t["name"], "qfmt": t["qfmt"], "afmt": t["afmt"]} for t in m["tmpls"]],
        })
    for nid in col.db.list("select id from notes order by id"):
        note = col.get_note(nid)
        out["notes"].append({
            "id": note.id, "guid": note.guid, "notetype": note.note_type()["name"],
            "fields": dict(note.items()), "tags": note.tags,
        })
    deck_names = {d["id"]: d["name"] for d in col.decks.all()}
    # Load every card before asking the scheduler anything: scheduler calls
    # may run Anki's daily unbury and change queues mid-dump.
    cards = [col.get_card(cid) for cid in col.db.list("select id from cards order by id")]
    raw_data = dict(col.db.all("select id, data from cards"))
    for card in cards:
        cid = card.id
        r = card.render_output(reload=True)
        entry = {
            "id": card.id, "nid": card.nid, "noteGuid": card.note().guid, "ord": card.ord,
            "deck": deck_names[card.did], "type": card.type, "queue": card.queue,
            "due": card.due, "ivl": card.ivl, "factor": card.factor, "reps": card.reps,
            "lapses": card.lapses, "left": card.left, "flags": card.flags,
            "odid": card.odid, "odue": card.odue,
            "data": raw_data[cid],
            "memoryState": (
                {"stability": card.memory_state.stability, "difficulty": card.memory_state.difficulty}
                if card.memory_state else None
            ),
            "desiredRetention": card.desired_retention,
            "decay": card.decay,
            "lastReviewTime": card.last_review_time,
            "render": {
                "question": r.question_text,
                "answer": r.answer_text,
                "questionAvTags": [str(t) for t in r.question_av_tags],
                "answerAvTags": [str(t) for t in r.answer_av_tags],
            },
        }
        if scheduling and card.queue >= 0 and card.type != 0 and card.memory_state:
            states = col._backend.get_scheduling_states(cid)
            nxt = {}
            for name in ("again", "hard", "good", "easy"):
                nxt[name] = state_dict(getattr(states, name))
            entry["next"] = {"current": state_dict(states.current), **nxt}
            cms = col.compute_memory_state(cid)
            entry["recomputedMemoryState"] = {
                "stability": cms.stability, "difficulty": cms.difficulty,
                "desiredRetention": cms.desired_retention, "decay": cms.decay,
            }
            # Fuzz is deterministic per card; record Anki's delta for each
            # candidate interval so tests can compare unfuzzed intervals.
            top = max(
                [nxt[k].get("scheduled_days", 0) or nxt[k].get("review", {}).get("scheduled_days", 0) for k in nxt]
            )
            entry["fuzzDelta"] = [col.fuzz_delta(cid, i) for i in range(0, int(top * 1.3) + 10)]
        out["cards"].append(entry)
    mdir = col.media.dir()
    for f in sorted(os.listdir(mdir)):
        data = open(os.path.join(mdir, f), "rb").read()
        out["media"][f] = {"size": len(data), "sha1": hashlib.sha1(data).hexdigest()}
    return out


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=False) + "\n")


def import_and_dump(pkg: Path, now: int, scheduling: bool) -> dict:
    d = tempfile.mkdtemp(prefix="wengu-imp-")
    try:
        col = Collection(os.path.join(d, "collection.anki2"))
        if pkg.suffix == ".colpkg":
            col.close()
            col._backend.import_collection_package(
                col_path=os.path.join(d, "collection.anki2"),
                backup_path=str(pkg),
                media_folder=os.path.join(d, "collection.media"),
                media_db=os.path.join(d, "collection.media.db2"),
            )
            col.reopen()
        else:
            req = ImportAnkiPackageRequest(
                package_path=str(pkg),
                options=ImportAnkiPackageOptions(
                    with_scheduling=scheduling, with_deck_configs=scheduling, merge_notetypes=False
                ),
            )
            col.import_anki_package(req)
        res = dump(col, scheduling=False, now=now)
        col.close()
        return res
    finally:
        shutil.rmtree(d, ignore_errors=True)


def derive_legacy1(src: Path, dst: Path) -> None:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if info.filename in ("meta", "collection.anki2"):
                continue
            data = zin.read(info.filename)
            name = "collection.anki2" if info.filename == "collection.anki21" else info.filename
            zout.writestr(zipfile.ZipInfo(name, date_time=info.date_time), data, zipfile.ZIP_DEFLATED)


def main() -> None:
    APKG_DIR.mkdir(exist_ok=True)
    EXPECTED_DIR.mkdir(exist_ok=True)
    work = tempfile.mkdtemp(prefix="wengu-gen-")
    col_path = os.path.join(work, "collection.anki2")
    col, ids = build_collection(col_path)
    last = simulate(col, ids["notes"])

    # A manual "set due date" after the history (revlog type 4 / Manual).
    tick(3600)
    col.sched.set_due_date([card_of(col, ids["notes"]["basic_img"]).id], "3")
    tick()
    # Suspended, buried, flagged cards.
    # Touch the scheduler first: the first access on a new day runs Anki's
    # automatic unbury, which would otherwise undo the burying below.
    _ = col.sched.today
    col.sched.get_queued_cards()
    col.sched.suspend_cards([card_of(col, ids["notes"]["opt_rev_on"], 1).id])
    col.sched.bury_cards([card_of(col, ids["notes"]["opt_rev_off"]).id], manual=True)
    col.sched.bury_cards([card_of(col, ids["notes"]["vocab_full"], 1).id], manual=False)
    col.set_user_flag_for_cards(3, [card_of(col, ids["notes"]["emoji"]).id])
    col.set_user_flag_for_cards(2, [card_of(col, ids["notes"]["cloze_edge"], 1).id])
    for key, ord_, queue in (("opt_rev_on", 1, -1), ("opt_rev_off", 0, -3), ("vocab_full", 1, -2)):
        q = card_of(col, ids["notes"][key], ord_).queue
        assert q == queue, (key, ord_, q, queue)
    tick()
    # Ground truth is taken at the moment of export.
    now = _now

    source = dump(col, scheduling=True, now=now)
    source["generator"] = {"start": START, "ids": ids, "scripts": {f"{k[0]}:{k[1]}": v for k, v in SCRIPTS.items()}}
    write_json(EXPECTED_DIR / "source.json", source)

    exports = {}

    def export(name: str, **opts) -> Path:
        out = APKG_DIR / name
        if out.exists():
            out.unlink()
        col.export_anki_package(
            out_path=str(out),
            options=ExportAnkiPackageOptions(**opts),
            limit=None,  # whole collection
        )
        exports[name] = opts
        tick()
        return out

    export("full-latest.apkg", with_scheduling=True, with_deck_configs=True, with_media=True, legacy=False)
    export("full-legacy.apkg", with_scheduling=True, with_deck_configs=True, with_media=True, legacy=True)
    export("shared-latest.apkg", with_scheduling=False, with_deck_configs=False, with_media=True, legacy=False)
    col_media_dir = col.media.dir()
    del col_media_dir
    for legacy, name in ((False, "full-latest.colpkg"),):
        out = APKG_DIR / name
        if out.exists():
            out.unlink()
        col.export_collection_package(str(out), include_media=True, legacy=legacy)
        col.reopen()
        exports[name] = {"legacy": legacy, "collectionPackage": True}

    col.close()

    # Anki >= 2.1.50 can no longer write the oldest layout (real data in
    # "collection.anki2", no "meta" file).  Derive one by repackaging Anki's
    # own legacy export: same schema-11 database and JSON media map, only the
    # zip layout differs.  Anki's importer is still the oracle for it.
    derive_legacy1(APKG_DIR / "full-legacy.apkg", APKG_DIR / "derived-legacy1.apkg")
    exports["derived-legacy1.apkg"] = {"derivedFrom": "full-legacy.apkg", "with_scheduling": True}

    manifest = {"ankiVersion": anki.buildinfo.version, "now": now, "packages": {}}
    for name, opts in exports.items():
        pkg = APKG_DIR / name
        sched = opts.get("with_scheduling", True)
        manifest["packages"][name] = {"options": opts, "size": pkg.stat().st_size}
        imported = import_and_dump(pkg, now, sched)
        write_json(EXPECTED_DIR / (name + ".import.json"), imported)
    write_json(EXPECTED_DIR / "manifest.json", manifest)
    shutil.rmtree(work, ignore_errors=True)
    print(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
