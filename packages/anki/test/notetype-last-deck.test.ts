import initSqlJs from 'sql.js';
import { expect, it } from 'vitest';
import { readSchema18 } from '../src/schema18.js';
import { notetypeJson } from '../src/schema11-write.js';

it('preserves the modern notetype last-deck id in legacy exports', async () => {
  const SQL=await initSqlJs();
  const db=new SQL.Database();
  try {
    // A minimal real schema-18 database; protobuf Config field 4 = 150.
    db.exec(`CREATE TABLE config(key TEXT,val BLOB);
      CREATE TABLE fields(ntid INTEGER,ord INTEGER,name TEXT,config BLOB);
      CREATE TABLE templates(ntid INTEGER,ord INTEGER,name TEXT,mtime_secs INTEGER,usn INTEGER,config BLOB);
      CREATE TABLE notetypes(id INTEGER,name TEXT,mtime_secs INTEGER,usn INTEGER,config BLOB);
      CREATE TABLE decks(id INTEGER,name TEXT,mtime_secs INTEGER,usn INTEGER,common BLOB,kind BLOB);
      CREATE TABLE deck_config(id INTEGER,name TEXT,mtime_secs INTEGER,usn INTEGER,config BLOB);
      CREATE TABLE tags(tag TEXT,usn INTEGER,collapsed INTEGER);
      INSERT INTO notetypes VALUES(100,'Example',0,0,x'209601');`);
    const parts=readSchema18(db,(d,sql)=>d.exec(sql)[0]?.values??[]);
    const nt=parts.notetypes[0]!;
    expect(nt.extra['did']).toBe(150);
    expect(notetypeJson(nt,()=>{} )['did']).toBe(150);
  } finally {db.close();}
});
