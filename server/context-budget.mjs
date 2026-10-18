import {dirname,posix} from 'node:path';
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {readFile,safePath} from './files.mjs';
export const CONTEXT_LIMIT=65536;
export function bytesCut(value,limit){let out='',bytes=0;for(const c of value){const n=Buffer.byteLength(c);if(bytes+n>limit)break;out+=c;bytes+=n;}return out;}
export function instructionPaths(request){
 const paths=['AGENTS.md','CLAUDE.md'];
 for(const file of request.paths||[]){const dirs=[];let dir=dirname(file);while(dir!=='.'&&dir!=='/'&&dirs.length<8){dirs.push(dir);dir=dirname(dir);}for(const d of dirs.reverse())for(const name of ['AGENTS.md','CLAUDE.md']){const p=posix.join(d,name);if(!paths.includes(p))paths.push(p);}}
 return paths;
}
export function instructionFile(root,path){try{const safe=safePath(root,path),m=statSync(safe);if(!m.isFile())return {hash:'unavailable'};if(m.size>8192)return {hash:'oversize'};const file=readFile(root,path);return {hash:file.hash,file};}catch(e){return {hash:e.code==='ENOENT'?null:'unavailable'};}}
export function instructionsValid(root,context){const manifest=context.instructionManifest||instructionPaths({paths:(context.files||[]).map(f=>f.path)}).map(path=>({path,hash:context.instructions?.find(f=>f.path===path)?.hash||null}));return manifest.every(f=>instructionFile(root,f.path).hash===f.hash);}
export function budgetContext(project,request,bundle,render){
 const paths=instructionPaths(request),warnings=[];
 bundle.instructions=[];bundle.acceptanceCriteria=request.acceptanceCriteria||'';
 bundle.instructionManifest=[];
 for(const path of paths){const {hash,file}=instructionFile(project.path,path);bundle.instructionManifest.push({path,hash});if(hash===null)continue;if(bundle.instructions.length>=8){warnings.push(`지침 수 제한: ${path}`);continue;}if(file)bundle.instructions.push(file);else warnings.push(`읽을 수 없거나 8KiB를 넘는 지침은 원문에서 확인하세요: ${path}`);}
 const initial={notes:bundle.notes.length,files:bundle.files.length,previous:bundle.previous.length};let omittedPinned=0;
 for(const f of bundle.files){const t=bytesCut(f.content,8192);if(t!==f.content){f.content=t;f.truncated=true;}}
 for(const n of bundle.notes){if(!n.pinned){const t=bytesCut(n.body,4000);if(t!==n.body){n.body=t;n.truncated=true;}}}
 while(Buffer.byteLength(render(bundle))>CONTEXT_LIMIT){
  if(bundle.previous.length){bundle.previous.pop();continue;}
  const index=bundle.notes.findLastIndex(n=>!n.pinned);if(index>=0){bundle.notes.splice(index,1);continue;}
  const f=bundle.files.filter(f=>Buffer.byteLength(f.content)>1024).sort((a,b)=>Buffer.byteLength(b.content)-Buffer.byteLength(a.content))[0];if(f){f.content=bytesCut(f.content,Math.floor(Buffer.byteLength(f.content)/2));f.truncated=true;continue;}
  if(bundle.notes.length){bundle.notes.pop();omittedPinned++;continue;}
  if(bundle.files.length){bundle.files.pop();continue;}
  if(bundle.instructions.length){warnings.push('맥락 예산으로 지침 생략: '+bundle.instructions.pop().path);continue;}
  throw new Error('목표와 완료 조건이 64KiB 맥락 예산을 초과합니다. 요청을 줄여 주세요.');
 }
 const prompt=render(bundle);
 return {...bundle,prompt,budget:{limitBytes:CONTEXT_LIMIT,promptBytes:Buffer.byteLength(prompt),omittedNotes:initial.notes-bundle.notes.length,omittedFiles:initial.files-bundle.files.length,omittedPrevious:initial.previous-bundle.previous.length,omittedPinned,truncatedFiles:bundle.files.filter(f=>f.truncated).length,truncatedNotes:bundle.notes.filter(n=>n.truncated).length,warnings}};
}
