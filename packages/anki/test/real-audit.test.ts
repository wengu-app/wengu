/** Opt-in independent audit; third-party content and reports stay next to the input, never in fixtures. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readAnkiPackage, renderCard, writeAnkiPackage, type AnkiPackage } from '../src/index.js';
import { openNodeEngine } from '../../core/src/node.js';
import { deckConfigJson, deckJson, notetypeJson } from '../src/schema11-write.js';
import { stringifyJson } from '../src/json.js';

type Obj = Record<string, any>;
const paths: string[] = JSON.parse(process.env['WENGU_AUDIT_PATHS'] ?? '[]');
const python = resolve('fixtures/.venv/bin/python');
const oracleScript = resolve('fixtures/real_oracle.py');
function oracle(path: string, output: string): Obj {
  execFileSync(python,[oracleScript,path,output],{env:{...process.env,RAYON_NUM_THREADS:'2'},timeout:180_000,maxBuffer:1024*1024});
  return JSON.parse(readFileSync(output,'utf8'));
}
const hash=(b: Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=(x: unknown)=>JSON.parse(stringifyJson(x));
// These are import/migration bookkeeping, not authored content. Legacy files have no
// stable per-field/template ids: Anki assigns fresh random ids when opening them.
function clean(x: any): any {
  if (Array.isArray(x)) return x.map(clean);
  if (x && typeof x==='object') return Object.fromEntries(Object.entries(x).filter(([k])=>!['mod','usn','id','mtime_secs'].includes(k) && !(k==='originalStockKind' && x[k]===0) && !(k==='originalId' && x[k]===null)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,clean(v)]));
  return x;
}
function diff(a: any,b: any,path='',out: string[]=[]): string[] {
  if (Object.is(a,b)) return out;
  if (typeof a!==typeof b || a===null || b===null || typeof a!=='object') {out.push(path);return out;}
  for(const k of new Set([...Object.keys(a),...Object.keys(b)])) diff(a[k],b[k],`${path}/${k}`,out);
  return out;
}
function view(p: AnkiPackage): Obj {
  const notes=new Map(p.notes.map(n=>[n.id,n]));
  return {
    notes:Object.fromEntries(p.notes.map(n=>[String(n.id),{id:n.id,guid:n.guid,notetypeId:n.notetypeId,fields:n.fields,tags:n.tags,flags:n.flags,data:n.data}])),
    cards:Object.fromEntries(p.cards.map(c=>[`${notes.get(c.noteId)!.guid}#${c.ord}`,{id:c.id,noteId:c.noteId,deckId:c.deckId,ord:c.ord,state:[c.type,c.queue,c.due,c.interval,c.easeFactor,c.reps,c.lapses,c.left,c.originalDue,c.originalDeckId,c.flags,c.rawData]}])),
    notetypes:p.notetypes.map(n=>json(notetypeJson(n,()=>{}))),
    decks:p.decks.map(d=>json(deckJson(d,()=>{}))),
    deckConfigs:p.deckConfigs.map(c=>json(deckConfigJson(c,()=>{}))),
    tags:p.tags.map(t=>[t.name,t.usn,t.collapsed?1:0]),tagNames:p.tags.map(t=>t.name).sort(),
    revlog:p.revlog.map(r=>[r.id,r.cardId,r.usn,r.ease,r.interval,r.lastInterval,r.factor,r.taken,r.kind]),
    media:Object.fromEntries(p.media.map(m=>[m.name,{size:m.data.length,sha256:hash(m.data)}])),
  };
}
function comparison(a: Obj,b: Obj): Obj {
  const r:Obj={};
  for(const k of ['notes','cards','revlog','media']){
    // JSON data columns may be reserialized by Anki during schema upgrades.
    const canon=(x:Obj)=>k==='cards'?Object.fromEntries(Object.entries(x).map(([id,c]:[string,any])=>[id,{...c,state:c.state.map((v:any,i:number)=>i===11 && v?JSON.parse(v):v)}])):x;
    const ds=diff(canon(a[k]),canon(b[k]));r[k]={pass:!ds.length,differences:ds.length,examples:ds.slice(0,15),count:Object.keys(b[k]).length};
  }
  for(const k of ['notetypes','decks','deckConfigs']){
    const by=(x:Obj[])=>Object.fromEntries(x.map(v=>[String(v.id),clean(v)]));
    const ds=diff(by(a[k]),by(b[k]));r[k]={pass:!ds.length,differences:ds.length,examples:ds.slice(0,30),count:b[k].length};
  }
  const names=(x:any[])=>x.map(t=>t[0]).sort();
  const ds=diff(a['tagNames']??names(a['tags']),b['tagNames']??names(b['tags']));r['tags']={pass:!ds.length,differences:ds.length,examples:ds.slice(0,15),count:(b['tagNames']??b['tags']).length};
  return r;
}
const norm=(s:string)=>s.replace(/hint[0-9a-f]{16}/g,'hintID').replace(/LaTeX image generation is disabled in the preferences\./g,'');
function rendered(p: AnkiPackage, o:Obj) {
  const notes=new Map(p.notes.map(n=>[n.id,n]));const nts=new Map(p.notetypes.map(n=>[n.id,n]));const decks=new Map(p.decks.map(d=>[d.id,d.name]));
  const cards=new Map(p.cards.map(c=>[`${notes.get(c.noteId)!.guid}#${c.ord}`,c]));
  const mismatches:Obj[]=[];
  for(const [key,exp] of Object.entries(o['renders']) as [string,Obj][]){
    const c=cards.get(key); if(!c){mismatches.push({key,missing:true});continue;}
    const n=notes.get(c.noteId)!;
    const r=renderCard({notetype:nts.get(n.notetypeId)!,note:n,cardOrd:c.ord,deckName:decks.get(c.originalDeckId||c.deckId)??'',flags:c.flags,cardId:c.id});
    const av=(tags:typeof r.questionAvTags)=>tags.map(t=>t.kind==='sound'?`SoundOrVideoTag(filename=${JSON.stringify(t.filename).replace(/^"|"$/g,"'")})`:JSON.stringify(t));
    for(const side of ['question','answer'] as const) if(norm(r[side])!==norm(exp[side])) {
      let i=0;while(i<r[side].length && r[side][i]===exp[side][i])i++;
      mismatches.push({key,side,offset:i,ours:r[side].slice(Math.max(0,i-50),i+180),anki:exp[side].slice(Math.max(0,i-50),i+180),errors:r.errors});
    }
    // Compare AV independently of the HTML placeholders.
    for(const side of ['question','answer'] as const){const k=side+'AvTags';if(diff(av(r[k as 'questionAvTags']),exp[k]).length)mismatches.push({key,side:k,ours:av(r[k as 'questionAvTags']),anki:exp[k]});}
  }
  const filters=new Set<string>();
  for(const n of p.notetypes)for(const t of n.templates)for(const m of (t.qfmt+t.afmt).matchAll(/\{\{([^{}]+)\}\}/g)){const f=m[1]!.split(':');f.pop();for(const x of f)filters.add(x);}
  const supported=/^(text|hint|cloze|cloze-only|furigana|kana|kanji|type|tts(?: .*)?)$/;
  return {pass:!mismatches.length,count:Object.keys(o['renders']).length,sides:Object.keys(o['renders']).length*2,differences:mismatches.length,examples:mismatches.slice(0,30),filters:[...filters],unsupportedFilters:[...filters].filter(f=>!supported.test(f))};
}

describe.skipIf(!paths.length)('independent real deck audit',()=>{
  for(const path of paths)it(path,async()=>{
    const started=performance.now(); console.log('audit start',path);
    const o=JSON.parse(readFileSync(path+'.original.json','utf8'));
    const t=performance.now();const bytes=new Uint8Array(readFileSync(path));const p=await readAnkiPackage(bytes);
    const readMs=performance.now()-t; console.log('read complete',readMs);
    const imported=comparison(view(p),o); console.log('import comparison complete'); const render=rendered(p,o);console.log('renders complete');
    const engine=await openNodeEngine();let core:Obj,rt:Obj,rtRender:Obj;const warnings:string[]=[];
    let importMs=0;
    try{
      const t=performance.now();const result=await engine.importAnki(p);importMs=performance.now()-t;
      console.log('core imported',importMs); const back=await engine.exportAnki(); console.log('core exported');
      core={comparison:comparison(view(back),view(p)),result};
      const output=path+'.wengu.apkg';
      writeFileSync(output,await writeAnkiPackage(back,{onWarning:m=>warnings.push(m)}));
      console.log('written',output); rt={pending:true};rtRender={pending:true};
    }finally{engine.db.close();}
    const report={path,bytes:bytes.length,sha256:hash(bytes),format:p.format,ankiVersion:o['ankiVersion'],imported,render,core,roundtrip:rt,roundtripRender:rtRender,warnings:[...p.warnings,...warnings],mediaReferences:{referenced:o['references'].length,missing:o['missingMedia'],unreferenced:o['unreferencedMedia']},timing:{readMs,coreImportMs:importMs,totalMs:performance.now()-started,processPeakRssKiB:process.resourceUsage().maxRSS}};
    writeFileSync(path+'.report.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    const failures=Object.entries({...imported,render,...Object.fromEntries(Object.entries(core!.comparison).map(([k,v])=>['core:'+k,v])),}).filter(([,v])=>!(v as Obj).pass).map(([k])=>k);
    expect(failures).toEqual([]);
  },240_000);
});

const roundtripPaths:string[]=JSON.parse(process.env['WENGU_AUDIT_ROUNDTRIP']??'[]');
describe.skipIf(!roundtripPaths.length)('official roundtrip comparison',()=>{
 for(const path of roundtripPaths)it(path,()=>{
  const o=JSON.parse(readFileSync(path+'.original.json','utf8'));
  const after=JSON.parse(readFileSync(path+'.wengu.apkg.oracle.json','utf8'));
  const r=JSON.parse(readFileSync(path+'.report.json','utf8'));
  r.roundtrip=comparison(after,o);
  const renders=(x:Obj)=>Object.fromEntries(Object.entries(x['renders']).map(([k,v]:[string,any])=>[k,[norm(v.question),norm(v.answer),v.questionAvTags,v.answerAvTags]]));
  const ds=diff(renders(after),renders(o));r.roundtripRender={pass:!ds.length,differences:ds.length,examples:ds.slice(0,20)};
  writeFileSync(path+'.report.json',JSON.stringify(r,null,2));
  console.log(JSON.stringify(r.roundtrip));
  expect(Object.entries(r.roundtrip).filter(([,v])=>!(v as Obj).pass).map(([k])=>k)).toEqual([]);
  expect(r.roundtripRender.pass).toBe(true);
 });
});
