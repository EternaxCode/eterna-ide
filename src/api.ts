import {native,desktopRequest} from './native';
const initial=new URLSearchParams(location.hash.slice(1)).get('token');
if(initial){sessionStorage.setItem('nexus-token',initial);history.replaceState(null,'',location.pathname);}
let stateTag:string|null=null,stateCache:unknown;
let nativeRevision:number|undefined;
let pendingState:Promise<any>|null=null;
async function request(path:string,body?:unknown,method?:string){
 if(native){try{const stateRead=path==='/state'&&!body;const route=stateRead&&nativeRevision!==undefined?`/state?since=${nativeRevision}`:path;const result=await desktopRequest(route,body,method) as any;if(stateRead){if(result.notModified&&stateCache)return stateCache;nativeRevision=result.revision;stateCache=result;}return result;}catch(e){throw new Error(typeof e==='string'?e:String(e));}}
 const conditional=path==='/state'&&!body;
 const headers:Record<string,string>={'Authorization':'Bearer '+(sessionStorage.getItem('nexus-token')||''),'Content-Type':'application/json'};
 if(conditional&&stateTag)headers['If-None-Match']=stateTag;
 const res=await fetch('/api'+path,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});
 if(res.status===304&&conditional)return stateCache;
 const data=await res.json();if(!res.ok)throw new Error(data.error||'요청에 실패했습니다.');
 if(conditional){stateTag=res.headers.get('etag');stateCache=data;}return data;
}
export function api(path:string,body?:unknown,method?:string):Promise<any>{
 if(path==='/state'&&!body){if(pendingState)return pendingState;pendingState=request(path).finally(()=>{pendingState=null;});return pendingState;}
 return request(path,body,method);
}
export function download(filename:string,content:string){if(native){import('@tauri-apps/api/core').then(({invoke})=>invoke('save_export',{filename,content})).catch(e=>alert(String(e)));return;}const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export type Project={id:string;name:string;path:string};
export type Note={id:string;projectId:string;title:string;body:string;kind:string;status:string;shared:boolean;pinned?:boolean;sourceRunId?:string;sourcePath?:string;sourceHash?:string;version:number;author:string;updatedAt:string};
export type Edge={id:string;from:string;to:string;label:string};
export type Run={id:string;projectId:string;goal:string;kind:string;provider:string;status:string;answer:string;output:string;error?:string;createdAt:string;exitCode?:number;contextId?:string;workspaceId?:string;answerTruncated?:boolean};
export type State={projects:Project[];notes:Note[];edges:Edge[];runs:Run[];runCount?:number;workspaces?:{id:string;projectId:string;path:string;createdAt:string;skipped:string[]}[]};
export type Provider={id:string;installed:boolean;connected:boolean;label:string;version?:string};
window.addEventListener('hashchange',()=>{const token=new URLSearchParams(location.hash.slice(1)).get('token');if(token){sessionStorage.setItem('nexus-token',token);history.replaceState(null,'',location.pathname);location.reload();}});
