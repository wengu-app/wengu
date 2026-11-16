#!/usr/bin/env python3
"""Ask the official Anki library what is inside arbitrary .apkg/.colpkg files.

For decks we cannot commit (e.g. popular shared decks), this writes
`<package>.oracle.json` next to each package: counts, note fields, media
names and Anki's rendered question/answer for every card. The optional test
`test/real-decks.test.ts` compares the TypeScript importer against it:

    fixtures/.venv/bin/python fixtures/oracle.py /path/to/decks/*.apkg
    REAL_DECKS_DIR=/path/to/decks pnpm --filter @wengu/anki test
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

from anki.collection import Collection
from anki.import_export_pb2 import ImportAnkiPackageOptions, ImportAnkiPackageRequest


def oracle(pkg: str) -> dict:
    d = tempfile.mkdtemp(prefix="wengu-oracle-")
    try:
        path = os.path.join(d, "collection.anki2")
        col = Collection(path)
        if pkg.endswith(".colpkg"):
            col.close()
            col._backend.import_collection_package(
                col_path=path,
                backup_path=os.path.abspath(pkg),
                media_folder=os.path.join(d, "collection.media"),
                media_db=os.path.join(d, "collection.media.db2"),
            )
            col.reopen()
        else:
            col.import_anki_package(
                ImportAnkiPackageRequest(
                    package_path=os.path.abspath(pkg),
                    options=ImportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True),
                )
            )
        out = {
            "counts": {
                "notes": col.note_count(),
                "cards": col.card_count(),
                "revlog": col.db.scalar("select count() from revlog"),
            },
            "notes": {},
            "cards": {},
            "media": sorted(os.listdir(col.media.dir())),
        }
        for nid in col.db.list("select id from notes"):
            note = col.get_note(nid)
            out["notes"][note.guid] = {"notetype": note.note_type()["name"], "fields": list(note.fields), "tags": note.tags}
        for cid in col.db.list("select id from cards"):
            card = col.get_card(cid)
            r = card.render_output(reload=True)
            out["cards"][f"{card.note().guid}#{card.ord}"] = {"question": r.question_text, "answer": r.answer_text}
        col.close()
        return out
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        with open(p + ".oracle.json", "w") as f:
            json.dump(oracle(p), f, ensure_ascii=False, indent=1)
        print("wrote", p + ".oracle.json")
