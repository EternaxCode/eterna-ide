import {readFileSync,realpathSync,statSync,mkdirSync,writeFileSync,lstatSync,unlinkSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
const templates=JSON.parse(readFileSync(new URL('../project-templates.json',import.meta.url),'utf8'));
export function validFolder(name){return typeof name==='string'&&name.length>0&&[...name].length<=80&&!/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)&&!/[. ]$/.test(name)&&!/^\.{1,2}$/.test(name)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);}
export function createProject(store,{name,parentPath,folderName,template}){
 if(typeof name!=='string'||!name.trim()||[...name].length>100||/[\x00-\x1f\x7f]/.test(name)||!validFolder(folderName))throw new Error('프로젝트 이름 또는 폴더 이름을 확인하세요.');
 if(!Object.hasOwn(templates,template))throw new Error('지원하지 않는 템플릿입니다.');
 const parent=realpathSync(parentPath);if(!statSync(parent).isDirectory())throw new Error('상위 폴더를 선택하세요.');const target=join(parent,folderName),spec=templates[template],created=[];
 try{mkdirSync(target);}catch(e){if(e.code==='EEXIST')throw new Error('이미 같은 이름의 폴더가 있습니다. 기존 폴더 연결을 사용하거나 이름을 바꾸세요.');throw e;}
 try{for(const [path,content] of Object.entries(spec.files)){const data=content.replaceAll('{{PROJECT_NAME}}',name.trim()),file=join(target,path);writeFileSync(file,data,{flag:'wx',mode:0o644});created.push([file,data]);}return store.create('project',{name:name.trim(),path:target,template,verificationCommand:process.platform==='win32'?(spec.windowsVerificationCommand||spec.verificationCommand):spec.verificationCommand});}
 catch(e){for(const [file,data] of created)try{if(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink()&&readFileSync(file,'utf8')===data)unlinkSync(file);}catch{}try{rmdirSync(target);}catch{}throw e;}
}
