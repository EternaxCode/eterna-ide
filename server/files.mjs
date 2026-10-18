import { readdirSync, lstatSync, realpathSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const hash=text=>createHash('sha256').update(text).digest('hex');
const excluded=new Set(['node_modules','target','.turbo','.git','.data','dist','build','.next','.venv','venv','vendor','.ssh','.aws','.codex','.claude','.nexus','coverage','artifacts']);
export const blocked=name=>excluded.has(name)||/^\.env(?:\.|$)/i.test(name)||/\.(pem|key|p12|pfx|sqlite|db)(-|$)/i.test(name)||/^(auth\.json|credentials.*|id_rsa|id_ed25519|\.npmrc|\.pypirc)$/i.test(name);
export function safePath(root,name){
 if(typeof name!=='string'||!name||isAbsolute(name)||name.includes('\0')||name.split(/[\\/]/).some(p=>p==='..'||blocked(p)))throw new Error('허용되지 않는 파일 경로입니다.');
 const base=realpathSync(root),target=resolve(base,name),rel=relative(base,target);
 if(rel.startsWith('..')||isAbsolute(rel))throw new Error('프로젝트 밖의 경로입니다.');
 let cursor=base;for(const segment of rel.split('/')){cursor=join(cursor,segment);if(lstatSync(cursor).isSymbolicLink())throw new Error('심볼릭 링크는 열 수 없습니다.');}
 return target;
}
export function readFile(root,name){const path=safePath(root,name);const st=lstatSync(path);if(!st.isFile()||st.size>512*1024)throw new Error('512KB 이하의 텍스트 파일만 열 수 있습니다.');const content=readFileSync(path,'utf8');if(content.includes('\0'))throw new Error('바이너리 파일은 지원하지 않습니다.');return {path:name,content,hash:hash(content)};}
export function saveFile(root,name,content,expectedHash){const before=readFile(root,name);if(!expectedHash||before.hash!==expectedHash)throw Object.assign(new Error('파일이 외부에서 변경되었습니다. 새로 열어 비교하세요.'),{status:409});if(Buffer.byteLength(content)>512*1024)throw new Error('파일 크기 제한을 초과했습니다.');const path=safePath(root,name),tmp=join(dirname(path),`.${basename(path)}.nexus-${randomUUID()}`);try{writeFileSync(tmp,content,{mode:lstatSync(path).mode,flag:'wx'});renameSync(tmp,path);}finally{try{unlinkSync(tmp);}catch{}}return readFile(root,name);}
export function listFiles(root){const results=[];function walk(dir,depth){if(depth>8||results.length>=2000)return;for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(blocked(e.name)||e.isSymbolicLink())continue;const path=join(dir,e.name);if(e.isDirectory())walk(path,depth+1);else if(e.isFile()&&results.length<2000)results.push(relative(root,path));}}walk(root,0);return results;}
