import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as pty from 'node-pty';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { cleanEnv,codexBinary } from './providers.mjs';
export function terminals(server,{store,port}){
 const tickets=new Map(),live=new Set();const wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
 function ticket(config){if(tickets.size>30)throw new Error('터미널 요청이 너무 많습니다.');const key=randomBytes(32).toString('hex');tickets.set(key,{...config,expires:Date.now()+30000});return key;}
 const sweep=setInterval(()=>{for(const [key,v] of tickets)if(v.expires<Date.now())tickets.delete(key);},30000);sweep.unref();
 server.on('upgrade',(req,socket,head)=>{const url=new URL(req.url,'http://127.0.0.1');const config=tickets.get(url.searchParams.get('ticket'));const origin=req.headers.origin;const allowed=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];if(url.pathname!=='/terminal'||!config||config.expires<Date.now()||!allowed.includes(origin)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}tickets.delete(url.searchParams.get('ticket'));wss.handleUpgrade(req,socket,head,ws=>{
  const {provider,action,project,context,workspaceId,args:configuredArgs}=config;
  const bin=provider==='codex'?codexBinary:'claude';
  const initialPrompt='먼저 .nexus/context.md를 읽으세요. 이 파일에 사용자의 작업 목표, 공유 지식, 선택한 파일과 검증 근거가 있습니다. 작업 사본에서 목표를 수행하고 결과를 한국어로 설명하세요. 원본 경로를 찾아 수정하지 마세요. 의존성 및 바이너리 파일은 사본에서 제외될 수 있습니다.';
  if(action==='work'){mkdirSync(join(project.path,'.nexus'),{recursive:true,mode:0o700});writeFileSync(join(project.path,'.nexus/context.md'),context.prompt,{mode:0o600});}
  const args=action==='login'?(provider==='codex'?['login']:['auth','login','--claudeai']):provider==='codex'?[...configuredArgs,initialPrompt]:['--safe-mode','--permission-mode','manual',initialPrompt];
  let term;try{term=pty.spawn(bin,args,{name:'xterm-256color',cols:100,rows:28,cwd:project.path,env:cleanEnv()});}catch(e){ws.send(`\r\n실행 실패: ${e.message}`);ws.close();return;}
  live.add(term);let stopping=false;const stop=()=>{if(stopping)return;stopping=true;try{process.kill(-term.pid,'SIGTERM');}catch{try{term.kill('SIGTERM');}catch{}}setTimeout(()=>{try{process.kill(-term.pid,'SIGKILL');}catch{}},2000).unref();};term.stopNexus=stop;let outputBytes=0;const run=action==='login'?null:store.create('run',{projectId:project.id,kind:'terminal',provider,status:'running',goal:context.goal,context,workspaceId,answer:'',output:'공식 CLI 터미널 세션. 출력은 자동으로 지식에 저장되지 않습니다.',events:[]});
  const timeout=setTimeout(()=>{ws.send('\r\n세션 시간 제한(2시간)에 도달했습니다.');stop();},7200000);
  term.onData(data=>{outputBytes+=data.length;if(ws.readyState===1)ws.send(data);if(outputBytes>20e6){stop();}});
  ws.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(m.type==='input'&&typeof m.data==='string')term.write(m.data.slice(0,65536));if(m.type==='resize')term.resize(Math.min(300,Math.max(20,Number(m.cols)||80)),Math.min(100,Math.max(5,Number(m.rows)||24)));}catch{}});
  term.onExit(({exitCode})=>{clearTimeout(timeout);live.delete(term);if(run)store.update('run',run.id,{status:'session_ended',exitCode,finishedAt:new Date().toISOString()});if(ws.readyState===1){ws.send(`\r\n\r\n[세션 종료 · exit ${exitCode}]`);ws.close();}});
  ws.on('close',()=>{clearTimeout(timeout);stop();});
 });});
 return {ticket,shutdown(){for(const t of live)t.stopNexus();wss.close();clearInterval(sweep);}};
}
