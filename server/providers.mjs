import {selectionFlags} from './models.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const bundled=fileURLToPath(new URL('../node_modules/.bin/codex',import.meta.url));
export const codexBinary=existsSync(bundled)?bundled:'codex';
export async function codexTerminalArgs(model='',options={}){const args=['--disable','hooks','--disable','plugins','-c','model_provider="openai"',...selectionFlags('codex',{...options,model},true)];try{const {stdout}=await exec(codexBinary,['--disable','plugins','--disable','hooks','mcp','list','--json'],{env:cleanEnv(),timeout:8000,maxBuffer:2e6});for(const server of JSON.parse(stdout))if(typeof server.name==='string'&&/^[a-zA-Z0-9_-]+$/.test(server.name))args.push('-c',`mcp_servers.${server.name}.enabled=false`);}catch{throw new Error('Codex 외부 도구 설정을 확인하지 못했습니다. 공식 CLI의 mcp list 상태를 확인하세요.');}return args;}
export function cleanEnv(source=process.env){const env={};for(const k of ['HOME','PATH','TMPDIR','LANG','LC_ALL','USER','LOGNAME','SHELL','TERM'])if(source[k])env[k]=source[k];return {...env,TERM:'xterm-256color'};}
export const classifyFailure=text=>/usage.?limit|rate.?limit|quota|429/i.test(text)?'limited':/not logged|unauthorized|login|authentication|401/i.test(text)?'auth_required':'failed';
export const codexArgs=(model,options={})=>['exec','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--ephemeral','--json','--color','never',...selectionFlags('codex',{...options,model},false),'-'];
export async function providerStatus(){return Promise.all(['codex','claude'].map(async id=>{try{const {stdout:version}=await exec(id==='codex'?codexBinary:id,['--version'],{env:cleanEnv(),timeout:5000});let text='';try{const r=await exec(id==='codex'?codexBinary:id,id==='codex'?['login','status']:['auth','status'],{env:cleanEnv(),timeout:8000});text=r.stdout+r.stderr;}catch(e){text=(e.stdout||'')+(e.stderr||'');}let connected=false,label='로그인 필요';if(id==='codex'){connected=/logged in using chatgpt/i.test(text);label=connected?'ChatGPT 구독 연결':/api key/i.test(text)?'API 인증 · 구독 로그인 필요':'로그인 필요';}else{try{const s=JSON.parse(text);connected=s.loggedIn===true&&s.authMethod==='claude.ai';label=connected?'Claude Code 로그인됨':'로그인 필요';}catch{}}return {id,installed:true,connected,label,version:version.trim(),mode:id==='codex'?'chat-and-terminal':'official-terminal',remaining:null};}catch{return {id,installed:false,connected:false,label:'CLI 설치 필요',remaining:null};}}));}
export const runTimeLimitMs=kind=>kind==='test'?120000:7200000;
export const timeoutMessage=kind=>`${kind==='test'?'테스트':'AI 작업'} 실행 시간 제한(${runTimeLimitMs(kind)/60000}분)에 도달해 중단했습니다. 이미 기록된 출력과 파일 변경은 유지됩니다. 로그를 확인한 뒤 이어서 작업을 요청하세요.`;
export class Runner {
 constructor(store){this.store=store;this.active=new Map();}
 stop(id,reason='cancelled'){const entry=this.active.get(id);if(entry){entry.reason=reason;try{process.kill(-entry.child.pid,'SIGTERM');}catch{entry.child.kill('SIGTERM');}setTimeout(()=>{try{process.kill(-entry.child.pid,'SIGKILL');}catch{}},2000).unref();}return this.store.get(id,'run');}
 start({project,goal,kind='ai',context,model='',effort='',permission='full',command=''}){
 if([...this.active.values()].some(x=>x.projectId===project.id))throw Object.assign(new Error('이 프로젝트에서 이미 실행 중입니다. 먼저 중단하거나 기다려주세요.'),{status:409});
 const run=this.store.create('run',{projectId:project.id,goal,kind,provider:kind==='ai'?'codex':'local',status:'running',answer:'',output:'',context:context??null,command,events:[]});
 const child=spawn(kind==='ai'?codexBinary:(process.platform==='darwin'?'/bin/zsh':'/bin/sh'),kind==='ai'?codexArgs(model,{effort,permission}):['-c',command],{cwd:project.path,env:cleanEnv(),detached:true,stdio:['pipe','pipe','pipe']});
 const entry={child,projectId:project.id,reason:null};this.active.set(run.id,entry);let answer='',output='',line='',events=[],exitError='',success=false;let ended=false;
 const flush=()=>{if(!ended)this.store.update('run',run.id,{answer,output,events:events.slice(-80)});};
 const timer=setTimeout(()=>this.stop(run.id,'timed_out'),runTimeLimitMs(kind));const pulse=setInterval(flush,500);
 const eventLine=text=>{try{const e=JSON.parse(text);if(e.type==='item.completed'&&e.item?.type==='agent_message')answer+=(answer?'\n\n':'')+e.item.text;if(e.type==='turn.completed')success=true;if(e.type==='turn.failed'||e.type==='error')exitError=e.error?.message||e.message||'AI 실행 실패';if(['turn.started','turn.completed','turn.failed','error'].includes(e.type))events.push({type:e.type,at:new Date().toISOString()});}catch{output=(output+text+'\n').slice(-60000);}};
 child.stdout.on('data',data=>{if(kind==='test'){output=(output+data.toString()).slice(-60000);return;}line+=data;const parts=line.split('\n');line=parts.pop();for(const l of parts)eventLine(l);if(line.length>2e6)this.stop(run.id,'output_limit');});
 child.stderr.on('data',data=>{output=(output+data.toString()).slice(-60000);});
 const finish=(code,error)=>{if(ended)return;if(line)eventLine(line);clearTimeout(timer);clearInterval(pulse);ended=true;this.active.delete(run.id);const message=error||exitError;const status=entry.reason||(code===0&&(kind==='test'||success&&!message)?'completed':classifyFailure(message+' '+output));this.store.update('run',run.id,{answer,output,events:events.slice(-80),status,exitCode:code,finishedAt:new Date().toISOString(),error:status==='completed'?null:status==='timed_out'?timeoutMessage(kind):message||`${status}: 실행 로그를 확인하세요.`});};
 child.on('error',e=>finish(null,e.message));child.on('close',code=>finish(code));child.stdin.end(kind==='ai'?context.prompt:undefined);return run;
 }
 shutdown(){for(const id of this.active.keys())this.stop(id,'interrupted');}
}
