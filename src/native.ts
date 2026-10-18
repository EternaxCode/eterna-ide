import {isTauri,invoke} from '@tauri-apps/api/core';
export const native=isTauri();
export async function desktopRequest(path:string,body?:unknown,method?:string){return invoke<any>('desktop_request',{method:method||(body?'POST':'GET'),path,body:body??null});}
export async function chooseFolder(){const {open}=await import('@tauri-apps/plugin-dialog');return open({directory:true,multiple:false,title:'작업할 프로젝트 폴더 선택'});}
export async function chooseLegacy(){const {open}=await import('@tauri-apps/plugin-dialog');return open({multiple:false,title:'기존 Eterna/Nexus SQLite 데이터 가져오기',filters:[{name:'SQLite database',extensions:['sqlite','db']}]});}
export async function openOfficial(provider:string){const {openUrl}=await import('@tauri-apps/plugin-opener');await openUrl(provider==='claude'?'https://code.claude.com/docs/en/setup':'https://developers.openai.com/codex/cli/');}
