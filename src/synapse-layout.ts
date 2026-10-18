export type SynapseEvent = {id:number; runId:string; kind:string; label:string; refs:{id:string;label:string;type:string}[]; createdAt:string};
export type GraphNode = {id:string;label:string;type:string;eventId:number;x:number;y:number;z:number};
export type SynapseGraph = {nodes:GraphNode[];links:[number,number][];omitted:number};
// Stable positions depend on identity, never on an animation clock or simulated activity.
function hash(value:string){let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
export function layoutEvents(events:SynapseEvent[],limit=300):SynapseGraph{
 const nodes:GraphNode[]=[],links:[number,number][]=[],indices=new Map<string,number>();let omitted=0;
 const add=(id:string,label:string,type:string,eventId:number)=>{const old=indices.get(id);if(old!==undefined)return old;if(nodes.length>=limit){omitted++;return -1;}const h=hash(id),angle=(h%3600)*Math.PI/1800,r=2.5+((h>>>12)%800)/100;const i=nodes.length;nodes.push({id,label,type,eventId,x:Math.cos(angle)*r,y:((h>>>20)%100)/10-5,z:Math.sin(angle)*r});indices.set(id,i);return i;};
 // Newest evidence stays inside the bounded GPU budget; timeline retains all fetched events.
 for(const event of [...events].reverse()){const a=add(`event:${event.id}`,event.label,'event',event.id);for(const ref of event.refs||[]){const b=add(ref.type==='tool'?`tool:${event.runId}:${ref.id}`:`${ref.type}:${ref.id}`,ref.label,ref.type,event.id);if(a>=0&&b>=0&&a!==b&&links.length<1200)links.push([a,b]);}}
 return {nodes,links,omitted};
}
export function mergeEvents(previous:SynapseEvent[],incoming:SynapseEvent[]){if(!incoming.length)return previous;const byId=new Map(previous.map(e=>[e.id,e]));for(const event of incoming)byId.set(event.id,event);return [...byId.values()].sort((a,b)=>a.id-b.id);}

export function normalizeEvents(value:unknown):SynapseEvent[]{
 if(!Array.isArray(value))return [];
 return value.filter(e=>e&&Number.isSafeInteger(e.id)&&typeof e.label==='string').map(e=>{
  let refs:unknown=e.refs;if(typeof refs==='string'){try{refs=JSON.parse(refs);}catch{refs=[];}}
  return {...e,runId:String(e.runId||''),kind:String(e.kind||'unknown'),createdAt:String(e.createdAt||''),refs:Array.isArray(refs)?refs.filter(r=>r&&typeof r.id==='string').map(r=>({id:r.id,label:String(r.label||r.id),type:String(r.type||'reference')})):[]};
 });
}
