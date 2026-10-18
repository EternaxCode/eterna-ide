import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
const now=()=>new Date().toISOString();
export class Store {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL);');}
 all(type){return this.db.prepare('SELECT data FROM records WHERE type=? ORDER BY rowid DESC').all(type).map(r=>JSON.parse(r.data));}
 get(id,type){const row=this.db.prepare('SELECT data,type FROM records WHERE id=?').get(id);if(!row||type&&row.type!==type)throw Object.assign(new Error('항목을 찾을 수 없습니다.'),{status:404});return JSON.parse(row.data);}
 put(type,data){this.db.prepare('INSERT INTO records(id,type,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id,type,JSON.stringify(data));return data;}
 create(type,data){return this.put(type,{...data,id:randomUUID(),createdAt:now(),updatedAt:now(),version:1});}
 update(type,id,patch,version){const old=this.get(id,type);if(version!==undefined&&old.version!==version)throw Object.assign(new Error('다른 작업에서 변경했습니다. 새로고침 후 다시 시도하세요.'),{status:409});return this.put(type,{...old,...patch,id,createdAt:old.createdAt,version:old.version+1,updatedAt:now()});}
 delete(type,id){this.get(id,type);this.db.prepare('DELETE FROM records WHERE id=? AND type=?').run(id,type);}
 projects(){return this.all('project');}
 addProject(name,path){const existing=this.projects().find(p=>p.path===path);return existing??this.create('project',{name,path});}
 notes(){return this.all('note');}
 addNote(data){return this.create('note',data);}
 runs(){return this.all('run');}
 recover(){for(const run of this.runs())if(run.status==='running')this.update('run',run.id,{status:'interrupted',error:'서버가 재시작되어 실행이 중단되었습니다. 기록을 확인하고 다시 실행하세요.'});}
 close(){this.db.close();}
}
