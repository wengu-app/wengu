#!/usr/bin/env python3
"""Record how Anki turns FSRS memory states into review intervals.

Writes fixtures/expected/review-intervals.json, used by test/review-intervals.test.ts.

Cards in four presets (default/custom FSRS-6 parameters, several desired retentions and maximum intervals) take a
random walk of answers: on the due day, early, late, and again on the same day. Before every answer the script
records the card (interval, reps, last review time, memory state) and Anki's answer for each rating (kind, days,
memory state). Everything is recorded twice: with fuzz, and without (ANKI_TEST_MODE, which makes Anki skip fuzz).

Usage (from packages/anki; libfaketime as described in generate.py):
    LIBFAKETIME=/path/to/libfaketime.so.1 fixtures/.venv/bin/python fixtures/intervals.py
"""

from __future__ import annotations

import calendar
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "expected" / "review-intervals.json"
START = "2025-03-01 09:00:00"
CUSTOM_FSRS6 = [0.3, 1.5, 3.0, 10.0, 6.0, 0.9, 2.8, 0.01, 1.7, 0.2, 0.9, 1.6, 0.07, 0.3, 1.5, 0.5, 2.0, 0.5, 0.1, 0.07, 0.2]
PRESETS = [
    {"name": "default 0.9", "dr": 0.9, "max": 36500, "params": []},
    {"name": "default 0.8 max 200", "dr": 0.8, "max": 200, "params": []},
    {"name": "custom 0.85 max 365", "dr": 0.85, "max": 365, "params": CUSTOM_FSRS6},
    {"name": "default 0.97", "dr": 0.97, "max": 36500, "params": []},
]
CARDS = 24
ANSWERS_PER_CARD = 14


def run_child(fuzz: bool, out: Path) -> None:
    lib = os.environ.get("LIBFAKETIME") or "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1"
    if not os.path.exists(lib):
        sys.exit("libfaketime not found; set LIBFAKETIME (see generate.py)")
    ts_file = Path(tempfile.mkdtemp(prefix="wengu-ft-")) / "now"
    ts_file.write_text(START + "\n")
    env = dict(os.environ)
    env.update(WENGU_FT_ACTIVE="1", LD_PRELOAD=lib, DYLD_INSERT_LIBRARIES=lib, FAKETIME_TIMESTAMP_FILE=str(ts_file),
               FAKETIME_NO_CACHE="1", TZ="UTC", WENGU_OUT=str(out))
    env.pop("ANKI_TEST_MODE", None)
    if not fuzz:
        env["ANKI_TEST_MODE"] = "1"
    r = subprocess.run([sys.executable, *sys.argv], env=env)
    shutil.rmtree(ts_file.parent, ignore_errors=True)
    if r.returncode:
        sys.exit(r.returncode)


def f32(x: float) -> float:
    """Shortest decimal that still round-trips the 32-bit float Anki computed."""
    return float(f"{x:.9g}")


def epoch(s: str) -> int:
    return calendar.timegm(time.strptime(s, "%Y-%m-%d %H:%M:%S"))


def simulate(seed: int) -> list[dict]:
    from anki.collection import Collection
    from anki.config import Config
    from anki.deck_config_pb2 import UPDATE_DECK_CONFIGS_MODE_NORMAL

    ts_file = Path(os.environ["FAKETIME_TIMESTAMP_FILE"])
    now = [epoch(START)]

    def set_now(t: int) -> None:
        now[0] = t
        tmp = ts_file.with_suffix(".tmp")
        tmp.write_text(time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t)) + "\n")
        os.replace(tmp, ts_file)
        assert abs(int(time.time()) - t) <= 1, "faketime is not active"

    fuzz = "ANKI_TEST_MODE" not in os.environ
    rnd = random.Random(seed)
    work = tempfile.mkdtemp(prefix="wengu-ivl-")
    set_now(epoch(START))
    col = Collection(os.path.join(work, "collection.anki2"))
    col.set_config_bool(Config.Bool.LOAD_BALANCER_ENABLED, False)

    decks = []
    for i, p in enumerate(PRESETS):
        did = col.decks.id(f"Intervals {i}")
        cur = col.decks.get_deck_configs_for_update(did)
        conf = type(cur.all_config[0].config)()
        conf.CopyFrom(next(c.config for c in cur.all_config if c.config.id == 1))
        conf.id = 0
        conf.name = p["name"]
        conf.config.desired_retention = p["dr"]
        # Without fuzz, Anki 26.09 panics ("min > max") when a relearning card's Easy would exceed a reached maximum,
        # so the unfuzzed run uses the default maximum everywhere.
        conf.config.maximum_review_interval = p["max"] if fuzz else 36500
        del conf.config.fsrs_params_6[:]
        conf.config.fsrs_params_6.extend(p["params"])
        col._backend.update_deck_configs(
            target_deck_id=did, configs=[conf], removed_config_ids=[], mode=UPDATE_DECK_CONFIGS_MODE_NORMAL,
            card_state_customizer="", limits=cur.current_deck.limits, new_cards_ignore_review_limit=False,
            fsrs=True, apply_all_parent_limits=False, fsrs_reschedule=False, fsrs_health_check=False,
        )
        set_now(now[0] + 1)
        decks.append((did, i, conf.config.maximum_review_interval))

    basic = col.models.by_name("Basic")
    cards = []
    for i in range(CARDS):
        did, preset, maximum = decks[i % len(decks)]
        note = col.new_note(basic)
        note["Front"] = f"card {i}"
        note["Back"] = "answer"
        col.add_note(note, did)
        set_now(now[0] + 1)
        cards.append((note.cards()[0].id, preset, maximum))

    records = []
    day0 = epoch(START) - epoch(START) % 86400
    pending = [[day0 + 10 * 3600 + i * 60, i, 0] for i in range(CARDS)]
    while pending:
        pending.sort()
        t, i, k = pending.pop(0)
        cid, preset, maximum = cards[i]
        set_now(max(t, now[0] + 1))
        card = col.get_card(cid)
        states = col._backend.get_scheduling_states(cid)
        if card.type in (1, 2, 3) and card.memory_state:
            nxt = {}
            for name in ("again", "hard", "good", "easy"):
                s = getattr(states, name).normal
                kind = s.WhichOneof("kind")
                st = getattr(s, kind)
                ms = (st.learning if kind == "relearning" else st).memory_state
                # [kind, scheduled days (review outcomes only), stability, difficulty]
                nxt[name] = [kind, st.scheduled_days if kind == "review" else None, f32(ms.stability), f32(ms.difficulty)]
            cur = states.current.normal
            records.append({
                "cardId": cid, "preset": preset, "max": maximum, "type": card.type, "reps": card.reps,
                "ivl": card.ivl, "due": card.due, "today": col.sched.today, "nextDayStart": col.sched.day_cutoff,
                "lastReviewTime": card.last_review_time,
                "memoryState": {"s": f32(card.memory_state.stability), "d": f32(card.memory_state.difficulty)},
                "currentElapsedDays": cur.review.elapsed_days if cur.WhichOneof("kind") == "review" else None,
                "next": nxt,
            })
        if k >= ANSWERS_PER_CARD:
            continue
        rating = rnd.choices([1, 2, 3, 4], weights=[1, 2, 6, 2])[0]
        card.start_timer()
        answer = col.sched.build_answer(card=card, states=states, rating=rating - 1)
        answer.milliseconds_taken = 2000
        col.sched.answer_card(answer)
        card = col.get_card(cid)
        if card.queue == 1:
            nt = card.due + 5
        elif card.queue in (2, 3):
            when = rnd.choices(["due", "same day", "early", "late"], weights=[3, 3, 2, 2])[0]
            if when == "same day":
                nt = now[0] + rnd.randint(60, 3 * 3600)
                if nt >= col.sched.day_cutoff:
                    nt = now[0] + 30
            else:
                day = card.due
                if when == "early":
                    day = max(col.sched.today + 1, card.due - rnd.randint(1, max(1, card.ivl // 2)))
                elif when == "late":
                    day = card.due + rnd.randint(1, max(1, card.ivl))
                nt = col.crt + day * 86400 + rnd.randint(0, 20 * 3600)
        else:
            nt = now[0] + 3600
        if nt - epoch(START) < 60 * 365 * 86400:
            pending.append([nt, i, k + 1])
    col.close()
    shutil.rmtree(work, ignore_errors=True)
    return records


def main() -> None:
    if os.environ.get("WENGU_FT_ACTIVE") == "1":
        import anki.buildinfo

        fuzz = "ANKI_TEST_MODE" not in os.environ
        records = simulate(seed=2 if fuzz else 1)
        Path(os.environ["WENGU_OUT"]).write_text(json.dumps({"ankiVersion": anki.buildinfo.version, "records": records}))
        return
    tmp = Path(tempfile.mkdtemp(prefix="wengu-ivl-out-"))
    run_child(True, tmp / "fuzz.json")
    run_child(False, tmp / "nofuzz.json")
    fuzzed = json.loads((tmp / "fuzz.json").read_text())
    unfuzzed = json.loads((tmp / "nofuzz.json").read_text())
    shutil.rmtree(tmp, ignore_errors=True)
    out = {
        "ankiVersion": fuzzed["ankiVersion"],
        "presets": [{"name": p["name"], "desiredRetention": p["dr"], "params": p["params"]} for p in PRESETS],
        "fuzzed": fuzzed["records"],
        "unfuzzed": unfuzzed["records"],
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(out['fuzzed'])} + {len(out['unfuzzed'])} records")


if __name__ == "__main__":
    main()
