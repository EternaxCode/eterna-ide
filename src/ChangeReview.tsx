import {useEffect,useState} from 'react';
import {diffLines} from 'diff';
import {Check,RefreshCw,X,GitCompareArrows} from 'lucide-react';
import {api} from './api';
type Change={path:string;before:string;after:string;hash:string|null;deleted:boolean;added:boolean};
export default function ChangeReview({id,onClose,onApplied}:{id:string;onClose:()=>void;onApplied:()=>void}){
 const [changes,setChanges]=useState<Change[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{const c=await api('/workspaces/'+id+'/changes');setChanges(c);setSelected(p=>c.some((x:Change)=>x.path===p)?p:c[0]?.path||'');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{load();},[id]);const current=changes.find(c=>c.path===selected);
 async function apply(){if(!current)return;if(current.deleted&&!confirm('원본에서 이 파일을 삭제할까요?'))return;setBusy(true);try{await api('/workspaces/'+id+'/apply',{path:current.path,hash:current.hash});await load();onApplied();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="overlay"><section className="dialog wide" role="dialog" aria-modal="true" aria-label="AI 변경 검토"><div className="dialog-title"><div><span className="eyebrow">REVIEW BEFORE APPLY</span><h2><GitCompareArrows size={20}/> AI 작업 사본의 변경</h2></div><button className="icon" aria-label="닫기" onClick={onClose}><X size={20}/></button></div><p className="small muted">AI는 별도 소스 사본에서 작업합니다. 파일별로 비교 후 원본에 적용하세요. 원본이 바뀌었으면 적용을 차단합니다. node_modules·비밀 파일·바이너리는 사본에서 제외됩니다.</p><div className="inline-actions"><select aria-label="변경 파일" value={selected} onChange={e=>setSelected(e.target.value)}>{changes.map(c=><option value={c.path} key={c.path}>{c.deleted?'삭제':c.added?'새 파일':'수정'} · {c.path}</option>)}</select><button className="icon" aria-label="변경 다시 확인" onClick={load}><RefreshCw size={16}/></button></div>{current?<div className="diff-view review-diff">{diffLines(current.before,current.after).map((p,i)=><pre key={i} className={p.added?'added':p.removed?'removed':''}>{p.value}</pre>)}</div>:<div className="empty">아직 변경이 없거나 모든 변경을 적용했습니다.</div>}{error&&<p className="error">{error}</p>}<button className="primary" disabled={!current||busy} onClick={apply}><Check size={16}/>{current?.deleted?'이 파일 삭제 적용':'이 파일 원본에 적용'}</button></section></div>;
}
