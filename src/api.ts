const initial=new URLSearchParams(location.hash.slice(1)).get('token');
if(initial){sessionStorage.setItem('nexus-token',initial);history.replaceState(null,'',location.pathname);}
export async function api(path:string,body?:unknown,method?:string){const res=await fetch('/api'+path,{method:method||(body?'POST':'GET'),headers:{'Authorization':'Bearer '+(sessionStorage.getItem('nexus-token')||''),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw new Error(data.error||'요청에 실패했습니다.');return data;}
export function download(filename:string,content:string){const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export type Project={id:string;name:string;path:string};
export type Note={id:string;projectId:string;title:string;body:string;kind:string;status:string;shared:boolean;sourcePath?:string;sourceHash?:string;version:number;author:string;updatedAt:string};
export type Edge={id:string;from:string;to:string;label:string};
export type Run={id:string;projectId:string;goal:string;kind:string;provider:string;status:string;answer:string;output:string;error?:string;createdAt:string;exitCode?:number;contextId?:string};
export type State={projects:Project[];notes:Note[];edges:Edge[];runs:Run[];workspaces?:{id:string;projectId:string;path:string;createdAt:string;skipped:string[]}[]};
export type Provider={id:string;installed:boolean;connected:boolean;label:string;version?:string};
window.addEventListener('hashchange',()=>{const token=new URLSearchParams(location.hash.slice(1)).get('token');if(token){sessionStorage.setItem('nexus-token',token);history.replaceState(null,'',location.pathname);location.reload();}});
