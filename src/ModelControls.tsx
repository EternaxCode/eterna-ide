import {useEffect,useState,useRef,useCallback} from 'react';
import {api} from './api';
export type Selection={model:string;effort:string;permission:'full'|'restricted'};
export type Model={id:string;label:string;description:string;efforts:string[];defaultEffort:string};
export type Catalog={models:Model[];source:string;checkedAt:string};
export const defaultSelection:Selection={model:'',effort:'',permission:'full'};
export function loadSelections():Record<string,Selection>{
 try {const saved=JSON.parse(localStorage.getItem('eterna-provider-selections')||'{}');return Object.fromEntries(['codex','claude'].map(id=>[id,{model:typeof saved[id]?.model==='string'?saved[id].model:(id==='codex'?localStorage.getItem('eterna-model')||'':''),effort:typeof saved[id]?.effort==='string'?saved[id].effort:'',permission:saved[id]?.permission==='restricted'?'restricted':'full'}]));}catch{return {codex:{...defaultSelection},claude:{...defaultSelection}};}
}
export function useModelCatalogs(){
 const [catalogs,setCatalogs]=useState<Record<string,Catalog>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[loading,setLoading]=useState<Record<string,boolean>>({});
 const epochs=useRef<Record<string,number>>({});
 const refresh=useCallback(async(id:string)=>{const epoch=(epochs.current[id]||0)+1;epochs.current[id]=epoch;setLoading(s=>({...s,[id]:true}));setErrors(s=>({...s,[id]:''}));try{const c=await api('/models/'+id+'?refresh=1');if(epochs.current[id]===epoch)setCatalogs(s=>({...s,[id]:c}));}catch(e){if(epochs.current[id]!==epoch)return;setCatalogs(s=>{const next={...s};delete next[id];return next;});setErrors(s=>({...s,[id]:String(e)}));}finally{if(epochs.current[id]===epoch)setLoading(s=>({...s,[id]:false}));}},[]);
 useEffect(()=>{void refresh('codex');void refresh('claude');},[refresh]);
 return {catalogs,errors,loading,refresh};
}
export function selectionValid(s:Selection,c?:Catalog){return !s.model?!s.effort:!!c?.models.some(m=>m.id===s.model&&(!s.effort||m.efforts.includes(s.effort)));}
export default function ModelControls({provider,value,onChange,catalog,error,loading,refresh}:{provider:string;value:Selection;onChange:(s:Selection)=>void;catalog?:Catalog;error?:string;loading?:boolean;refresh:()=>void}){
 const model=catalog?.models.find(m=>m.id===value.model),name=provider==='codex'?'Codex':'Claude';
 return <section className="model-controls" aria-label={`${name} 실행 선택`}>
 <div className="model-selects"><label>Model<select aria-label={`${name} Model`} value={value.model} disabled={loading} onChange={e=>onChange({...value,model:e.target.value,effort:''})}><option value="">공식 CLI 기본값</option>{value.model&&!model&&<option value={value.model} disabled>{value.model} · 현재 목록에서 확인 안 됨</option>}{catalog?.models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
 <label>Effort<select aria-label={`${name} Effort`} value={value.effort} disabled={loading||!model?.efforts.length} onChange={e=>onChange({...value,effort:e.target.value})}><option value="">{model?.efforts.length?'CLI 기본값':'모델 기본값'}</option>{value.effort&&!model?.efforts.includes(value.effort)&&<option disabled value={value.effort}>{value.effort} · 지원 안 됨</option>}{model?.efforts.map(e=><option key={e} value={e}>{e}</option>)}</select></label>
 <label>권한<select aria-label={`${name} 권한`} value={value.permission} onChange={e=>onChange({...value,permission:e.target.value as Selection['permission']})}><option value="full">전체 액세스</option><option value="restricted">제한 모드</option></select></label></div>
 <div className="model-catalog-status"><span>{loading?'공식 CLI에서 목록 확인 중…':error?'목록 조회 실패 · 공식 기본값만 사용 가능':catalog?`공식 CLI 조회 · ${catalog.models.length}개 모델`:'목록 확인 전'}</span><button type="button" className="text-button" disabled={loading} onClick={refresh}>목록 새로고침</button></div>
 {error&&<p className="small error">{error}</p>}{!selectionValid(value,catalog)&&<p className="small error">현재 지원하는 모델과 effort를 다시 선택하세요.</p>}
 <p className="small muted">{value.permission==='full'?'전체 액세스: 파일 변경과 명령 실행을 별도 승인 없이 허용합니다.':'제한 모드: Codex 채팅은 읽기 전용, 코딩 터미널은 도구의 승인 절차를 따릅니다.'}</p>
 </section>;
}
