import {mkdirSync,writeFileSync,lstatSync,existsSync,unlinkSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,listFiles,saveFile,safePath,blocked,hash} from './files.mjs';
export function createWorkspace(store,project,data){
 const paths=listFiles(project.path);if(paths.length>=2000)throw new Error('작업 사본은 2,000개 미만의 소스 파일을 지원합니다. 더 작은 프로젝트 폴더를 선택하세요.');
 const baseline={},skipped=[];let bytes=0;for(const path of paths){try{const f=readFile(project.path,path);baseline[path]=f;bytes+=Buffer.byteLength(f.content);}catch{skipped.push(path);}}
 if(bytes>20*1024*1024)throw new Error('작업 사본의 텍스트가 20MB를 초과합니다. 더 작은 프로젝트를 선택하세요.');
 const folder=join(data,'workspaces',randomUUID());mkdirSync(folder,{recursive:true,mode:0o700});for(const f of Object.values(baseline)){const dest=join(folder,f.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,f.content,{mode:lstatSync(join(project.path,f.path)).mode & 0o777});}
 // A local repository keeps the official CLIs' workspace expectations intact.
 execFileSync('git',['init','-q',folder],{stdio:'ignore'});
 return store.create('workspace',{projectId:project.id,path:folder,baseline,skipped,applied:[]});
}
export function workspaceChanges(store,id){const w=store.get(id,'workspace'),changes=[];const names=new Set([...Object.keys(w.baseline),...listFiles(w.path)]);for(const name of names){let after=null;try{after=readFile(w.path,name);}catch{if(existsSync(join(w.path,name)))continue;}const before=w.baseline[name];if((after?.hash||null)===(before?.hash||null))continue;changes.push({path:name,before:before?.content??'',after:after?.content??'',deleted:!after,added:!before,hash:after?.hash??null});}return changes;}
export function applyChange(store,id,name,expectedAfter){const w=store.get(id,'workspace'),p=store.get(w.projectId,'project');const change=workspaceChanges(store,id).find(c=>c.path===name);if(!change)throw new Error('적용할 변경이 없습니다.');if(expectedAfter!==undefined&&expectedAfter!==change.hash)throw Object.assign(new Error('검토 후 작업 사본이 변경되었습니다. 다시 비교하세요.'),{status:409});const base=w.baseline[name];
 if(base){if(change.deleted){if(readFile(p.path,name).hash!==base.hash)throw new Error('원본 파일이 변경되었습니다.');unlinkSync(safePath(p.path,name));}else saveFile(p.path,name,change.after,base.hash);}
 else {if(isAbsolute(name)||name.split(/[\\/]/).some(v=>!v||v==='..'||blocked(v)))throw new Error('허용되지 않는 경로입니다.');let cursor=p.path;const parts=name.split('/');for(const part of parts.slice(0,-1)){cursor=join(cursor,part);if(existsSync(cursor)){if(lstatSync(cursor).isSymbolicLink()||!lstatSync(cursor).isDirectory())throw new Error('허용되지 않는 디렉터리입니다.');}else mkdirSync(cursor);}writeFileSync(join(p.path,name),change.after,{flag:'wx'});}
 const baseline={...w.baseline};if(change.deleted)delete baseline[name];else baseline[name]={path:name,content:change.after,hash:hash(change.after)};store.update('workspace',id,{baseline,applied:[...w.applied,{path:name,at:new Date().toISOString()}]});return {ok:true};
}
