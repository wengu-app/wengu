#!/usr/bin/env python3
"""Import packages into fresh collections with the official Anki library and
dump what Anki ended up with.  Used as the oracle for the .apkg writer.

    LIBFAKETIME=/path/to/libfaketime.so.1 \
        fixtures/.venv/bin/python fixtures/reimport.py spec.json

spec.json:
    {"now": <unix seconds>,
     "jobs": [{"package": "/abs/x.apkg", "scheduling": true, "out": "/abs/x.json"}, ...]}

Every import happens in its own empty collection with the clock frozen at
`now` (libfaketime, as in generate.py), so two packages that carry the same
data produce identical dumps: Anki's import-time ids and timestamps depend
only on the clock.  The dump is generate.py's ground-truth dump (the format
of fixtures/expected/*.import.json) plus a "raw" section with every column
and JSON key Anki stores for the imported objects.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate  # noqa: E402  (re-execs this script under libfaketime)
from generate import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest, dump, rows, set_now  # noqa: E402
from google.protobuf.json_format import MessageToDict  # noqa: E402


def raw_dump(col: Collection, preexisting_notetypes: set[int]) -> dict:
    deck_names = {d["id"]: d["name"] for d in col.decks.all()}
    nt_names = {m["id"]: m["name"] for m in col.models.all()}
    conf_names = {c["id"]: c["name"] for c in col.decks.all_config()}

    def deck_json(d: dict) -> dict:
        d = dict(d)
        if "conf" in d:
            d["conf"] = conf_names.get(d["conf"], d["conf"])
        return d

    return {
        "col": dict(zip(["crt", "ver"], col.db.first("select crt, ver from col"))),
        # The stock notetypes of the empty target collection get random field and
        # template ids on every run; only the imported notetypes are of interest.
        "notetypes": sorted((m for m in col.models.all() if m["id"] not in preexisting_notetypes), key=lambda m: m["name"]),
        "decks": sorted((deck_json(d) for d in col.decks.all()), key=lambda d: d["name"]),
        "deckConfigs": sorted(col.decks.all_config(), key=lambda c: c["name"]),
        "tags": rows(col, "select tag, usn, collapsed from tags order by tag"),
        "notes": [
            [r[0], r[1], nt_names.get(r[2], r[2]), *r[3:]]
            for r in rows(col, "select id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data from notes order by id")
        ],
        "cards": [
            [r[0], r[1], deck_names.get(r[2], r[2]), *r[3:15], deck_names.get(r[15], r[15]), *r[16:]]
            for r in rows(
                col,
                "select id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid,"
                " flags, data from cards order by id",
            )
        ],
        "revlog": rows(col, "select id, cid, usn, ease, ivl, lastIvl, factor, time, type from revlog order by id"),
        # Anki's protobuf view of the same objects: covers settings that the
        # legacy JSON view above might not expose.
        "proto": {
            "notetypes": [
                proto_dict(col._backend.get_notetype(m["id"]))
                for m in sorted(col.models.all(), key=lambda m: m["name"])
                if m["id"] not in preexisting_notetypes
            ],
            "decks": [proto_dict(col._backend.get_deck(did=d["id"])) for d in sorted(col.decks.all(), key=lambda d: d["name"])],
            "deckConfigs": [
                proto_dict(col._backend.get_deck_config(c["id"])) for c in sorted(col.decks.all_config(), key=lambda c: c["name"])
            ],
        },
    }


def proto_dict(msg) -> dict:
    return MessageToDict(msg, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)


def import_and_dump(pkg: str, now: int, scheduling: bool) -> dict:
    d = tempfile.mkdtemp(prefix="wengu-reimport-")
    try:
        set_now(now)
        col = Collection(os.path.join(d, "collection.anki2"))
        preexisting = {m["id"] for m in col.models.all()}
        req = ImportAnkiPackageRequest(
            package_path=pkg,
            options=ImportAnkiPackageOptions(with_scheduling=scheduling, with_deck_configs=scheduling, merge_notetypes=False),
        )
        log = col.import_anki_package(req)
        res = dump(col, scheduling=False, now=now)
        res["raw"] = raw_dump(col, preexisting)
        res["importLog"] = {
            "new": len(log.log.new),
            "updated": len(log.log.updated),
            "duplicate": len(log.log.duplicate),
            "conflicting": len(log.log.conflicting),
            "first_field_match": len(log.log.first_field_match),
            "missing_notetype": len(log.log.missing_notetype),
            "missing_deck": len(log.log.missing_deck),
            "empty_first_field": len(log.log.empty_first_field),
        }
        col.close()
        return res
    finally:
        shutil.rmtree(d, ignore_errors=True)


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text())
    now = int(spec["now"])
    for job in spec["jobs"]:
        try:
            out = import_and_dump(job["package"], now, bool(job.get("scheduling", True)))
        except Exception as e:  # report per package, keep going
            out = {"error": f"{type(e).__name__}: {e}"}
        Path(job["out"]).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("ok", len(spec["jobs"]), "generator", generate.__name__)


if __name__ == "__main__":
    main()
