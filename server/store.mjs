import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
const now=()=>new Date().toISOString();
export class Store {
 constructor(path){
  this.db=new DatabaseSync(path);this.revision=0;this.cache=new Map();
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS records_type ON records(type);
   CREATE TABLE IF NOT EXISTS record_summaries (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS summaries_type ON record_summaries(type);`);
  // One-time, additive migration. Full contexts and source snapshots stay intact.
  for(const row of this.db.prepare("SELECT r.data,r.type FROM records r LEFT JOIN record_summaries s ON r.id=s.id WHERE r.type IN ('run','workspace') AND s.id IS NULL ORDER BY r.rowid").all())this.writeSummary(row.type,JSON.parse(row.data));
 }
 writeSummary(type,data){if(!['run','workspace'].includes(type))return;let summary;
  if(type==='run'){const {context,output,answer,...rest}=data;summary={...rest,answer:answer?.slice(0,8000),answerTruncated:(answer?.length||0)>8000,output:output?.slice(-4000),contextId:context?.id};}
  else{const {baseline,...rest}=data;summary=rest;}
  this.db.prepare('INSERT INTO record_summaries VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id,type,JSON.stringify(summary));
 }
 all(type){const key='all:'+type;if(this.cache.has(key))return this.cache.get(key);const result=this.db.prepare('SELECT data FROM records WHERE type=? ORDER BY rowid DESC').all(type).map(r=>JSON.parse(r.data));if(type!=='run')this.cache.set(key,result);return result;}
 summaries(type,limit=100,offset=0){const key=`summary:${type}:${limit}:${offset}`;if(this.cache.has(key))return this.cache.get(key);const result=this.db.prepare('SELECT data FROM record_summaries WHERE type=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(type,limit,offset).map(r=>JSON.parse(r.data));this.cache.set(key,result);return result;}
 count(type){return this.db.prepare('SELECT count(*) AS n FROM records WHERE type=?').get(type).n;}
 get(id,type){const row=this.db.prepare('SELECT data,type FROM records WHERE id=?').get(id);if(!row||type&&row.type!==type)throw Object.assign(new Error('항목을 찾을 수 없습니다.'),{status:404});return JSON.parse(row.data);}
 invalidate(type){this.revision++;for(const key of this.cache.keys())if(key===`all:${type}`||key.startsWith(`summary:${type}:`))this.cache.delete(key);}
 put(type,data){this.db.exec('SAVEPOINT record_write');try{this.db.prepare('INSERT INTO records(id,type,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id,type,JSON.stringify(data));this.writeSummary(type,data);this.db.exec('RELEASE record_write');}catch(e){this.db.exec('ROLLBACK TO record_write; RELEASE record_write');throw e;}this.invalidate(type);return data;}
 create(type,data){return this.put(type,{...data,id:randomUUID(),createdAt:now(),updatedAt:now(),version:1});}
 update(type,id,patch,version){const old=this.get(id,type);if(version!==undefined&&old.version!==version)throw Object.assign(new Error('다른 작업에서 변경했습니다. 새로고침 후 다시 시도하세요.'),{status:409});return this.put(type,{...old,...patch,id,createdAt:old.createdAt,version:old.version+1,updatedAt:now()});}
 delete(type,id){this.get(id,type);this.db.exec('SAVEPOINT record_delete');try{this.db.prepare('DELETE FROM records WHERE id=? AND type=?').run(id,type);this.db.prepare('DELETE FROM record_summaries WHERE id=?').run(id);this.db.exec('RELEASE record_delete');}catch(e){this.db.exec('ROLLBACK TO record_delete; RELEASE record_delete');throw e;}this.invalidate(type);}
 projects(){return this.all('project');}
 addProject(name,path){const existing=this.projects().find(p=>p.path===path);return existing??this.create('project',{name,path});}
 notes(){return this.all('note');}
 addNote(data){return this.create('note',data);}
 runs(){return this.all('run');}
 recentAiRuns(projectId,limit=20){return this.db.prepare("SELECT id FROM record_summaries WHERE type='run' AND json_extract(data,'$.projectId')=? AND json_extract(data,'$.kind')='ai' AND json_extract(data,'$.status')='completed' ORDER BY rowid DESC LIMIT ?").all(projectId,limit).map(r=>this.get(r.id,'run'));}
 recover(){for(const row of this.db.prepare("SELECT id FROM record_summaries WHERE type='run' AND json_extract(data,'$.status')='running'").all())this.update('run',row.id,{status:'interrupted',error:'서버가 재시작되어 실행이 중단되었습니다. 기록을 확인하고 다시 실행하세요.'});}
 close(){this.db.close();}
}
