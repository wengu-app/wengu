import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const paths=process.argv.slice(2).map(p=>resolve(p));
if(!paths.length){console.error('Usage: pnpm --filter @wengu/anki verify:real /absolute/deck.apkg [...]');process.exit(2);}
const cwd=fileURLToPath(new URL('..',import.meta.url));
let failed=false;
function run(cmd,args,env={}){const r=spawnSync(cmd,args,{cwd,stdio:'inherit',env:{...process.env,RAYON_NUM_THREADS:'2',...env}});if(r.status!==0)failed=true;return r.status===0;}
const testArgs=['pnpm','exec','vitest','run','test/real-audit.test.ts','--maxWorkers=1','--disableConsoleIntercept'];
for(const path of paths){
 if(!run(resolve(cwd,'fixtures/.venv/bin/python'),['fixtures/real_oracle.py',path,path+'.original.json']))continue;
 run('corepack',testArgs,{WENGU_AUDIT_PATHS:JSON.stringify([path])});
 if(!run(resolve(cwd,'fixtures/.venv/bin/python'),['fixtures/real_oracle.py',path+'.wengu.apkg',path+'.wengu.apkg.oracle.json']))continue;
 run('corepack',testArgs,{WENGU_AUDIT_ROUNDTRIP:JSON.stringify([path])});
}
process.exit(failed?1:0);
