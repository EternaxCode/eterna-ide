import {invoke} from '@tauri-apps/api/core';
import {api} from './api';
let started=false;
export async function runDesktopSmoke(showSynapse:(projectId:string)=>void){
 if(started)return;started=true;const checks:Record<string,unknown>={};
 try{
  const state=await api('/state');const project=state.projects[0];if(!project)throw new Error('No native project');checks.state=true;
  const files=await api('/projects/'+project.id+'/files');const path=files.find((f:string)=>f.endsWith('.js'))||files[0];const file=await api('/projects/'+project.id+'/file?path='+encodeURIComponent(path));checks.file=!!file.hash;
  const note=await api('/notes',{projectId:project.id,title:'한국어 네이티브 검증',body:'IPC를 통한 실제 저장·복원 검증입니다.',kind:'lesson',status:'verified',shared:false});checks.note=!!note.id&&(await api('/state')).notes.some((n:any)=>n.id===note.id&&n.body==='IPC를 통한 실제 저장·복원 검증입니다.');
  const created=await api('/projects/create',{name:'네이티브 생성 검증',parentPath:project.path,folderName:'native-created-'+Date.now(),template:'javascript'});checks.projectCreation=(await api('/projects/'+created.id+'/files')).includes('index.test.mjs')&&created.verificationCommand==='node --test';
  const archived=await api('/notes/'+note.id+'/archive',{version:note.version});checks.archive=archived.archived===true;
  const restored=await api('/notes/'+note.id+'/restore',{version:archived.version});checks.restore=restored.archived===false&&(await api('/notes/'+note.id+'/history')).length===2;
  checks.memoryReview=Array.isArray((await api('/projects/'+project.id+'/memory-review',{})).duplicates);
  const run=await api('/tests',{projectId:project.id,command:'echo ETERNA_NATIVE_SMOKE'});let result;for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,250));result=await api('/runs/'+run.id);if(result.status!=='running')break;}if(result.status!=='completed')throw new Error(JSON.stringify(result));checks.process=result.output?.includes('ETERNA_NATIVE_SMOKE');
  const events=await api('/events?after=0');if(!events.events.length)throw new Error('No observed events');checks.events=events.events.length;
  showSynapse(project.id);for(let i=0;i<80&&!document.querySelector('.synapse-timeline li');i++)await new Promise(r=>setTimeout(r,250));checks.timeline=!!document.querySelector('.synapse-timeline li')&&document.querySelector('.synapse-detail')?.textContent?.includes(run.id);
  const rendered=()=>{const host=document.querySelector<HTMLElement>('.synapse-canvas');return !!host?.querySelector('canvas')&&Number(host.dataset.nodes)>0&&Number(host.dataset.renderedFrames)>0;};for(let i=0;i<60&&!rendered();i++)await new Promise(r=>setTimeout(r,250));checks.webgl=rendered();
  if(!checks.projectCreation||!checks.archive||!checks.restore||!checks.memoryReview||!checks.state||!checks.file||!checks.note||!checks.timeline||!checks.process||!checks.webgl)throw new Error('Native event/render checks failed');
  await invoke('finish_smoke',{report:{ok:true,checks,platform:navigator.userAgent}});
 }catch(error){await invoke('finish_smoke',{report:{ok:false,checks,error:String(error)}});}
}
