import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import WebSocket from 'ws';
const url=new URL(readFileSync('.data/launch-url','utf8'));const token=new URLSearchParams(url.hash.slice(1)).get('token');
async function req(path,body){const r=await fetch(url.origin+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
const s=await req('/state');const project=s.projects.find(p=>p.name==='시작 프로젝트');const t=await req('/terminal',{projectId:project.id,goal:'도구 실행이나 파일 변경 없이 “Nexus 터미널 연결 확인”이라고만 답해 주세요.',paths:['greet.mjs'],includeShared:false,provider:'codex',action:'work'});
console.log('Workspace',t.workspace.id);const ws=new WebSocket(url.origin.replace('http','ws')+'/terminal?ticket='+t.ticket,{origin:url.origin});let out='';let answeredTrust=false;const timer=setTimeout(()=>{ws.close();console.log('TIMEOUT terminal output (tail):',out.slice(-4000));},25000);
ws.on('message',data=>{out+=data.toString();if(data.toString().includes('\x1b[6n'))ws.send(JSON.stringify({type:'input',data:'\x1b[1;1R'}));if(out.includes('trust')&&!answeredTrust){answeredTrust=true;ws.send(JSON.stringify({type:'input',data:'\r'}));}if(out.includes('Nexus 터미널 연결 확인')&&out.includes('Worked for')){ws.close();}});
ws.on('close',()=>{clearTimeout(timer);mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/terminal-smoke.txt',out);console.log('Terminal output captured',out.length,'characters');});
ws.on('error',console.error);
