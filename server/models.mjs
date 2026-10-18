import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import {cleanEnv,codexBinary} from './providers.mjs';
const cache=new Map();
export function normalize(provider,rows=[]){return rows.filter(m=>!m.hidden&&!m.disabled).map(m=>({id:provider==='codex'?m.model:m.value,label:m.displayName,description:m.description||'',efforts:provider==='codex'?(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort):m.supportsEffort?m.supportedEffortLevels||[]:[],defaultEffort:m.defaultReasoningEffort||'',isDefault:m.isDefault||m.value==='default'})).filter(m=>typeof m.id==='string'&&m.id.length>0);}
export async function modelCatalog(provider,refresh=false){
 if(!['codex','claude'].includes(provider))throw new Error('지원하지 않는 제공사');
 const old=cache.get(provider);if(!refresh&&old&&Date.now()-old.at<60000)return old.data;
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(provider==='codex'?codexBinary:'claude',provider==='codex'?['--disable','hooks','--disable','plugins','app-server']:['--safe-mode','--print','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence'],{cwd:tmpdir(),env:cleanEnv(),stdio:['pipe','pipe','ignore'],detached:process.platform!=='win32'});
  let done=false,total=0,pages=0,models=[];const lines=createInterface({input:child.stdout});
  const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);lines.close();child.stdin.destroy();try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill();}catch{};error?reject(error):resolve(data);};
  const timer=setTimeout(()=>finish(new Error('모델 목록 조회 시간 초과. 공식 CLI 연결을 확인하세요.')),15000);
  const send=v=>{if(!done)child.stdin.write(JSON.stringify(v)+'\n');};
  child.on('error',e=>finish(e));child.stdin.on('error',e=>finish(e));child.on('exit',()=>{if(!done)finish(new Error('모델 조회 CLI가 종료되었습니다.'));});
  lines.on('line',line=>{total+=line.length;if(total>2000000){finish(new Error('모델 응답 크기 제한'));return;}let v;try{v=JSON.parse(line);}catch{return;}
   if(provider==='codex'&&v.id===1){if(v.error){finish(new Error('Codex 초기화 실패'));return;}send({method:'initialized'});send({id:2,method:'model/list',params:{limit:100,includeHidden:false}});}
   else if(provider==='codex'&&v.id===2){if(v.error){finish(new Error('Codex 모델 조회 실패'));return;}models.push(...normalize(provider,v.result?.data));if(v.result?.nextCursor){if(++pages>10){finish(new Error('모델 페이지 제한'));return;}send({id:2,method:'model/list',params:{limit:100,cursor:v.result.nextCursor,includeHidden:false}});return;}finish(null,{provider,models,source:'official-cli',checkedAt:new Date().toISOString()});}
   else if(provider==='claude'&&v.type==='control_response'&&v.response?.request_id==='eterna-models'){if(v.response.subtype!=='success'){finish(new Error('Claude 모델 조회 실패'));return;}finish(null,{provider,models:normalize(provider,v.response.response?.models),source:'official-cli',checkedAt:new Date().toISOString()});}
  });
  send(provider==='codex'?{id:1,method:'initialize',params:{clientInfo:{name:'eterna',version:'0.3.1'}}}:{type:'control_request',request_id:'eterna-models',request:{subtype:'initialize'}});
 });
 if(!result.models.length)throw new Error('선택 가능한 모델이 없습니다.');cache.set(provider,{at:Date.now(),data:result});return result;
}
export async function validateSelection(provider,{model='',effort=''}){if(!model){if(effort)throw new Error('모델을 먼저 선택하세요.');return;}const c=await modelCatalog(provider);const m=c.models.find(m=>m.id===model);if(!m||effort&&!m.efforts.includes(effort))throw new Error('현재 모델 목록이 지원하지 않는 모델 또는 effort입니다. 목록을 새로고침하세요.');}
export function selectionFlags(provider,{model='',effort='',permission='full'}={},interactive=true){
 if(!['full','restricted'].includes(permission))throw new Error('지원하지 않는 권한');
 const a=provider==='codex'?(permission==='full'?['--dangerously-bypass-approvals-and-sandbox']:['--sandbox',interactive?'workspace-write':'read-only',...(interactive?['--ask-for-approval','on-request']:[])]):(permission==='full'?['--dangerously-skip-permissions']:['--permission-mode','manual']);
 if(model)a.push('--model',model);if(effort)a.push(...(provider==='codex'?['-c','model_reasoning_effort='+JSON.stringify(effort)]:['--effort',effort]));return a;
}
