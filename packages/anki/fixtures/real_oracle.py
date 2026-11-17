#!/usr/bin/env python3
"""Independent real-deck oracle. Python 3.14 + fixtures/.venv's official anki.
Never executes template JS or LaTeX. Only opens temporary copies of collections.
Usage: real_oracle.py PACKAGE OUTPUT.json [--latest OUTPUT.apkg] [--import]
"""
from __future__ import annotations
import argparse, hashlib, json, os, tempfile, zipfile
import faulthandler
faulthandler.dump_traceback_later(45)
from pathlib import Path
from compression import zstd
from anki.collection import Collection
from anki.config import Config
from anki.import_export_pb2 import MediaEntries, ExportAnkiPackageOptions, ImportAnkiPackageRequest, ImportAnkiPackageOptions
import anki.buildinfo


def unpack(pkg: Path, root: Path):
    with zipfile.ZipFile(pkg) as z:
        entry = next(n for n in ('collection.anki21b', 'collection.anki21', 'collection.anki2') if n in z.namelist())
        def decode(b):
            return zstd.decompress(b) if b.startswith(b'\x28\xb5\x2f\xfd') else b
        (root / 'collection.anki2').write_bytes(decode(z.read(entry)))
        media = root / 'collection.media'
        media.mkdir()
        raw = z.read('media') if 'media' in z.namelist() else b'{}'
        if raw.startswith(b'\x28\xb5\x2f\xfd'):
            entries = MediaEntries.FromString(decode(raw)).entries
            mapping = {str(e.legacy_zip_filename if e.HasField('legacy_zip_filename') else i): e.name for i,e in enumerate(entries)}
        else:
            mapping = json.loads(raw)
        for key, name in mapping.items():
            if Path(name).name != name or name in ('.', '..') or '\\' in name:
                raise ValueError('unsafe media filename')
            if key in z.namelist():
                (media / name).write_bytes(decode(z.read(key)))
    return entry


def snapshot(col):
    col.set_config_bool(Config.Bool.RENDER_LATEX, False)
    nts = {m['id']: m for m in col.models.all()}
    decks = {d['id']: d for d in col.decks.all()}
    notes = {str(nid): {'id':nid, 'guid':guid, 'notetypeId':mid, 'fields':flds.split('\x1f'), 'tags':tags.split(), 'flags':flags, 'data':data}
             for nid,guid,mid,flds,tags,flags,data in col.db.all('select id,guid,mid,flds,tags,flags,data from notes order by id')}
    cards = {}
    samples = {}
    for row in col.db.all('select id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data from cards order by id'):
        cid,nid,did,ord_,*state = row
        key = f'{notes[str(nid)]["guid"]}#{ord_}'
        cards[key] = {'id':cid,'noteId':nid,'deckId':did,'ord':ord_, 'state':state}
        group = (notes[str(nid)]['notetypeId'], ord_)
        # Up to three cards per actual template/cloze ordinal, deterministic by id.
        if samples.get(group, 0)<3:
            samples[group]=samples.get(group,0)+1
    renders = {}
    quotas = {}
    for key,c in cards.items():
        group=(notes[str(c['noteId'])]['notetypeId'],c['ord'])
        if quotas.get(group,0)>=3:continue
        quotas[group]=quotas.get(group,0)+1
        r=col.get_card(c['id']).render_output(reload=True)
        renders[key]={'question':r.question_text,'answer':r.answer_text,
                      'questionAvTags':[str(a) for a in r.question_av_tags], 'answerAvTags':[str(a) for a in r.answer_av_tags]}
    media = {p.name: {'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in Path(col.media.dir()).iterdir() if p.is_file()}
    refs=set()
    for n in notes.values():
        refs.update(col.media.files_in_str(n['notetypeId'], '\x1f'.join(n['fields']), include_remote=False))
    # Static template and CSS references are included separately; dynamic JS references cannot be inferred.
    for mid,m in nts.items():
        for t in m['tmpls']:
            refs.update(col.media.files_in_str(mid,t['qfmt']+t['afmt'],include_remote=False))
    return {'ankiVersion':anki.buildinfo.version,'notes':notes,'cards':cards,
            'notetypes':list(nts.values()),'decks':list(decks.values()),'deckConfigs':col.decks.all_config(),
            'tags':col.db.all('select tag,usn,collapsed from tags order by tag'),
            'tagNames':sorted(set(col.db.list('select tag from tags')) | {t for n in notes.values() for t in n['tags']}),
            'revlog':col.db.all('select id,cid,usn,ease,ivl,lastIvl,factor,time,type from revlog order by id'),
            'renders':renders,'media':media,'references':sorted(refs),
            'missingMedia':sorted(refs-media.keys()),'unreferencedMedia':sorted(media.keys()-refs)}


def main():
    p=argparse.ArgumentParser();p.add_argument('package',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--latest',type=Path);p.add_argument('--import',dest='import_',action='store_true');a=p.parse_args()
    old=os.getcwd()
    with tempfile.TemporaryDirectory(prefix='wengu-real-oracle-') as d:
        root=Path(d)
        if not a.import_:entry=unpack(a.package.resolve(),root)
        else:entry='official-package-import'
        col=Collection(str(root/'collection.anki2'))
        try:
            if a.import_:
                col.import_anki_package(ImportAnkiPackageRequest(package_path=str(a.package.resolve()),options=ImportAnkiPackageOptions(with_scheduling=True,with_deck_configs=True)))
            out=snapshot(col);out['entry']=entry
            if a.latest:
                col.export_anki_package(out_path=str(a.latest.resolve()),options=ExportAnkiPackageOptions(with_scheduling=True,with_deck_configs=True,with_media=True,legacy=False),limit=None)
        finally:
            col.close();os.chdir(old)
        a.output.write_text(json.dumps(out,ensure_ascii=False))
    faulthandler.cancel_dump_traceback_later()
    print(a.output)
if __name__=='__main__':main()
