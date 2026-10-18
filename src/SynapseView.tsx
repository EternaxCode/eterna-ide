import {useEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {api} from './api';
import {mergeEvents,normalizeEvents,type SynapseEvent,type SynapseGraph} from './synapse-layout';
import './synapse.css';

const emptyGraph:SynapseGraph={nodes:[],links:[],omitted:0};
function GraphCanvas({graph,selectedId,onSelect,onFailure}:{graph:SynapseGraph;selectedId:number|null;onSelect:(id:number)=>void;onFailure:()=>void}){
 const host=useRef<HTMLDivElement>(null);
 const callbacks=useRef({onSelect,onFailure});callbacks.current={onSelect,onFailure};
 useEffect(()=>{
  const element=host.current;if(!element)return;
  element.dataset.nodes=String(graph.nodes.length);element.dataset.renderedFrames='0';
  let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{callbacks.current.onFailure();return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));element.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,1,.1,150);camera.position.set(0,8,27);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=9;controls.maxDistance=55;
  const geometry=new THREE.SphereGeometry(.15,10,8),material=new THREE.MeshBasicMaterial({color:0xffffff});
  const mesh=new THREE.InstancedMesh(geometry,material,graph.nodes.length);const matrix=new THREE.Matrix4();
  graph.nodes.forEach((node,i)=>{matrix.makeScale(node.eventId===selectedId?1.7:1,node.eventId===selectedId?1.7:1,node.eventId===selectedId?1.7:1);matrix.setPosition(node.x,node.y,node.z);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(node.eventId===selectedId?'#e8c97b':node.type==='event'?'#c1d8a0':'#6e9c85'));});scene.add(mesh);
  const positions:number[]=[];graph.links.forEach(([a,b])=>{const n=graph.nodes[a],m=graph.nodes[b];positions.push(n.x,n.y,n.z,m.x,m.y,m.z);});
  const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));const lineMaterial=new THREE.LineBasicMaterial({color:0x749984,transparent:true,opacity:.32});scene.add(new THREE.LineSegments(lineGeometry,lineMaterial));
  let frame=0,until=0,disposed=false;
  const render=()=>{frame=0;if(disposed||document.hidden)return;renderer.render(scene,camera);element.dataset.renderedFrames=String(Number(element.dataset.renderedFrames||0)+1);if(performance.now()<until)frame=requestAnimationFrame(render);};
  const draw=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(render);};
  // Only a short real-data refresh burst; orbit is event-driven and idle has zero frames.
  until=performance.now()+(matchMedia('(prefers-reduced-motion: reduce)').matches?0:180);draw();
  controls.addEventListener('change',draw);
  const resize=new ResizeObserver(()=>{const {width,height}=element.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();draw();});resize.observe(element);
  const visible=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else draw();};document.addEventListener('visibilitychange',visible);
  let down={x:0,y:0};const pointerDown=(event:PointerEvent)=>{down={x:event.clientX,y:event.clientY};};
  const select=(event:PointerEvent)=>{if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)return;const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObject(mesh)[0];if(hit?.instanceId!==undefined)callbacks.current.onSelect(graph.nodes[hit.instanceId].eventId);};
  const lost=(event:Event)=>{event.preventDefault();callbacks.current.onFailure();};renderer.domElement.addEventListener('webglcontextlost',lost);renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',select);
  return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();document.removeEventListener('visibilitychange',visible);controls.dispose();geometry.dispose();material.dispose();lineGeometry.dispose();lineMaterial.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',select);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 },[graph,selectedId]);
 return <div className="synapse-canvas" ref={host} role="img" aria-label="실행 이벤트와 원본 참조의 3차원 관계 지도. 아래 타임라인으로 같은 사건을 선택할 수 있습니다."/>;
}

export default function SynapseView({projectId}:{projectId?:string}){
 const [events,setEvents]=useState<SynapseEvent[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [live,setLive]=useState(true),[selectedId,setSelectedId]=useState<number|null>(null),[mode,setMode]=useState<'3d'|'text'>('3d'),[unavailable,setUnavailable]=useState(false);
 const [graph,setGraph]=useState<SynapseGraph>(emptyGraph),[layoutError,setLayoutError]=useState(false);
 useEffect(()=>{let stopped=false,busy=false,after=0;setEvents([]);setSelectedId(null);setLive(true);setGraph(emptyGraph);setLoading(true);setError('');
  const poll=async()=>{if(stopped||busy||document.hidden)return;busy=true;try{const data=await api(`/events?after=${after}${projectId?`&projectId=${encodeURIComponent(projectId)}`:''}`);if(!stopped){setEvents(old=>mergeEvents(old,normalizeEvents(data.events)));after=Math.max(after,data.lastId||0);setError('');}}catch(e){if(!stopped)setError(e instanceof Error?e.message:'실행 기록을 불러오지 못했습니다.');}finally{busy=false;if(!stopped)setLoading(false);}};
  void poll();const timer=setInterval(poll,2500);document.addEventListener('visibilitychange',poll);return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
 },[projectId]);
 const selectedIndex=live?events.length-1:events.findIndex(e=>e.id===selectedId),selected=events[selectedIndex];
 const visibleEvents=useMemo(()=>events.slice(0,Math.max(0,selectedIndex+1)),[events,selectedIndex]);
 useEffect(()=>{if(mode!=='3d')return;let worker:Worker;try{worker=new Worker(new URL('./synapse-layout.worker.ts',import.meta.url),{type:'module'});worker.onmessage=message=>{setGraph(message.data.graph);setLayoutError(false);};worker.onerror=()=>{setLayoutError(true);setMode('text');};worker.postMessage({generation:1,events:visibleEvents});}catch{setLayoutError(true);setMode('text');return;}return()=>worker.terminate();},[visibleEvents,mode]);
 const choose=(id:number)=>{setLive(false);setSelectedId(id);};
 return <section className="synapse-view" aria-label="Synapse 실행 기록">
  <header className="synapse-heading"><div><span className="synapse-eyebrow">SYNAPSE / 실행 기록</span><h2>작업이 남긴 연결</h2><p>관측된 사건과 참조를 탐색합니다. 모델의 비공개 사고 과정이 아닙니다.</p></div><div className="synapse-modes" role="group" aria-label="표시 방식"><button aria-pressed={mode==='3d'} disabled={unavailable} onClick={()=>setMode('3d')}>3D 지도</button><button aria-pressed={mode==='text'} onClick={()=>setMode('text')}>텍스트</button></div></header>
  {error&&<p className="synapse-alert" role="alert">{error} · 저장된 화면을 유지하며 다시 연결합니다.</p>}
  {(unavailable||layoutError)&&<p role="status">{unavailable?'이 환경에서 WebGL을 사용할 수 없어':'그래프 배치 작업자를 시작할 수 없어'} 텍스트로 표시합니다.</p>}
  <div className="synapse-body"><div className="synapse-map">
   {mode==='3d'&&events.length>0?<><GraphCanvas graph={graph} selectedId={selected?.id??null} onSelect={choose} onFailure={()=>{setUnavailable(true);setMode('text');}}/><div className="synapse-map-caption"><span>드래그하여 회전 · 스크롤하여 확대</span><span>{graph.nodes.length}개 노드{graph.omitted>0?' · 300개 표시 한도 적용':''}</span></div></>:<div className="synapse-text-map">{loading?<p>실행 기록을 불러오는 중…</p>:events.length===0?<><h3>아직 관측된 사건이 없습니다</h3><p>작업을 실행하면 실제 사건과 참조가 이곳에 나타납니다.</p></>:<><h3>{selected?.label||'사건을 선택하세요'}</h3><p>타임라인에서 사건을 선택하면 실제 참조를 확인할 수 있습니다.</p><ul>{selected?.refs.map((ref,i)=><li key={`${ref.type}:${ref.id}:${i}`}><span>{ref.type}</span> {ref.label}<code>{ref.id}</code></li>)}</ul></>}</div>}
   <p className="synapse-disclosure">연결은 이벤트의 실제 참조입니다. 위치·거리·밝기는 관련성 점수나 검증 수준을 뜻하지 않습니다. 제공사가 노출하지 않은 단계는 관측되지 않습니다.</p>
  </div><aside className="synapse-detail" aria-label="선택한 사건"><span className="synapse-eyebrow">선택한 실행 기록</span>{selected?<><h3>{selected.label}</h3><time>{new Date(selected.createdAt).toLocaleString('ko-KR')}</time><dl><dt>사건 종류</dt><dd>{selected.kind}</dd><dt>실행 ID</dt><dd>{selected.runId}</dd><dt>사건 순번</dt><dd>{selected.id}</dd></dl><h4>원본 참조 · {selected.refs.length}</h4>{selected.refs.length?<ul>{selected.refs.map((ref,i)=><li key={`${ref.id}:${i}`}><strong>{ref.label}</strong><small>{ref.type}</small><code>{ref.id}</code></li>)}</ul>:<p>이 사건에는 원본 참조가 기록되지 않았습니다.</p>}</>:<p>기록이 도착하면 상세 내용이 표시됩니다.</p>}</aside></div>
  <div className="synapse-replay"><div><label htmlFor="synapse-time">사건 리플레이 <span>{events.length?selectedIndex+1:0} / {events.length}</span></label><button aria-pressed={live} onClick={()=>{if(live)setSelectedId(selected?.id??null);setLive(!live);}}>{live?'최신 기록 따라가는 중':'최신 기록 따라가기'}</button></div><input id="synapse-time" type="range" min="0" max={Math.max(0,events.length-1)} value={Math.max(0,selectedIndex)} disabled={!events.length} aria-valuetext={selected?`${selectedIndex+1}번째 사건: ${selected.label}`:'사건 없음'} onChange={e=>choose(events[Number(e.target.value)].id)}/></div>
  <ol className="synapse-timeline" aria-label="실행 타임라인">{events.slice().reverse().map(event=><li key={event.id}><button aria-current={selected?.id===event.id?'step':undefined} onClick={()=>choose(event.id)}><time>{new Date(event.createdAt).toLocaleTimeString('ko-KR')}</time><span>{event.label}</span><small>{event.refs.length}개 참조</small></button></li>)}</ol>
 </section>;
}
