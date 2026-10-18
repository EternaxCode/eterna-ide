import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);const data=join(root,'.data');mkdirSync(data,{recursive:true,mode:0o700});
async function ready(){try{const url=readFileSync(join(data,'launch-url'),'utf8');const u=new URL(url);const token=new URLSearchParams(u.hash.slice(1)).get('token');const r=await fetch(u.origin+'/api/state',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});return r.ok?url:null;}catch{return null;}}
let url=await ready();if(!url){const build=spawnSync('npm',['run','build'],{stdio:'inherit'});if(build.status!==0)process.exit(1);spawnSync(process.execPath,['scripts/prepare-pty.mjs'],{stdio:'inherit'});const log=openSync(join(data,'server.log'),'a',0o600);const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,detached:true,stdio:['ignore',log,log]});child.unref();closeSync(log);for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));url=await ready();if(url)break;}if(!url){console.error('서버를 시작하지 못했습니다. .data/server.log를 확인하세요.');process.exit(1);}}
console.log('Nexus IDE: '+url);if(!process.argv.includes('--no-open'))spawn('open',[url],{stdio:'ignore'}).unref();
