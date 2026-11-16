#!/usr/bin/env python3
"""Reference exports for the .apkg writer tests, made by Anki itself.

Restores fixtures/apkg/full-latest.colpkg (the complete fixture collection)
and exports it in the legacy format with the option combinations the writer
supports, so tests can check that our writer makes the same choices Anki
makes (what "without scheduling" strips, what a single-deck export
contains):

    LIBFAKETIME=/path/to/libfaketime.so.1 fixtures/.venv/bin/python fixtures/writer_refs.py

Writes fixtures/apkg/ref-*.apkg and adds them to fixtures/expected/writer-refs.json.
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
from generate import APKG_DIR, EXPECTED_DIR, Collection, set_now  # noqa: E402
from anki.collection import DeckIdLimit  # noqa: E402
from anki.import_export_pb2 import ExportAnkiPackageOptions  # noqa: E402

SUBSET_DECK = "Wengu Test::Languages"

REFS = {
    # name: (deck limit, with_scheduling, with_deck_configs)
    "ref-legacy-nosched.apkg": (None, False, False),
    "ref-legacy-nosched-presets.apkg": (None, False, True),
    "ref-legacy-sched-nopresets.apkg": (None, True, False),
    "ref-legacy-subdeck.apkg": (SUBSET_DECK, True, True),
    "ref-legacy-subdeck-nosched.apkg": (SUBSET_DECK, False, False),
}


def main() -> None:
    manifest = json.loads((EXPECTED_DIR / "manifest.json").read_text())
    now = manifest["now"]
    set_now(now)
    d = tempfile.mkdtemp(prefix="wengu-refs-")
    try:
        path = os.path.join(d, "collection.anki2")
        col = Collection(path)
        col.close()
        col._backend.import_collection_package(
            col_path=path,
            backup_path=str(APKG_DIR / "full-latest.colpkg"),
            media_folder=os.path.join(d, "collection.media"),
            media_db=os.path.join(d, "collection.media.db2"),
        )
        col.reopen()
        out = {"ankiVersion": generate.anki.buildinfo.version, "now": now, "subsetDeck": SUBSET_DECK, "packages": {}}
        for name, (deck, sched, presets) in REFS.items():
            set_now(now)
            limit = DeckIdLimit(col.decks.id_for_name(deck)) if deck else None
            target = APKG_DIR / name
            if target.exists():
                target.unlink()
            col.export_anki_package(
                out_path=str(target),
                options=ExportAnkiPackageOptions(
                    with_scheduling=sched, with_deck_configs=presets, with_media=True, legacy=True
                ),
                limit=limit,
            )
            out["packages"][name] = {"deck": deck, "withScheduling": sched, "withDeckConfigs": presets}
        col.close()
    finally:
        shutil.rmtree(d, ignore_errors=True)
    (EXPECTED_DIR / "writer-refs.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
