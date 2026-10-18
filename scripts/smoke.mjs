import {readFileSync} from 'node:fs';
const url=readFileSync('.data/launch-url','utf8');const token=new URLSearchParams(new URL(url).hash.slice(1)).get('token');
const req=async(path,body)=>{const r=await fetch('http://127.0.0.1:4317/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(JSON.stringify(d));return d;};
const state=await req('/state');const p=state.projects[0];console.log('Provider status:',JSON.stringify(await req('/providers')));
const run=await req('/runs',{projectId:p.id,goal:'첨부된 greet.mjs를 읽고 greet(\" Nexus \") 결과를 설명해 주세요. 코드 변경이나 도구 실행 없이 한국어 두 문장으로 답하세요.',paths:['greet.mjs'],includeShared:false});
console.log('Run:',run.id);let result;for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));result=await req('/runs/'+run.id);if(result.status!=='running')break;}
console.log(JSON.stringify({status:result.status,answer:result.answer,error:result.error,output:result.output?.slice(-1500)}));if(result.status!=='completed')process.exitCode=1;
