import {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Pause, Play, RotateCcw} from 'lucide-react';
import type {Note, Edge} from './api';
import './knowledge-graph.css';

const colors:Record<string,string>={verified:'#8df5d1',candidate:'#b9a0ff',stale:'#ffbb81',superseded:'#8295ab'};
export default function KnowledgeGraph({notes,edges,selected,onSelect}:{notes:Note[];edges:Edge[];selected?:string;onSelect:(id:string)=>void}) {
 const host=useRef<HTMLDivElement>(null);
 const actions=useRef({reset:()=>{},draw:()=>{}});
 const current=useRef({selected,onSelect,moving:false});
 const [failed,setFailed]=useState(false);
 const [moving,setMoving]=useState(()=>!matchMedia('(prefers-reduced-motion: reduce)').matches);
 current.current={selected,onSelect,moving};
 // Native state polling returns fresh arrays even when graph contents are unchanged.
 // Keep scene inputs stable so polling cannot reset an orbit or recreate the GPU context.
 const nodeKey=JSON.stringify(notes.slice(0,180).map(({id,title,status})=>({id,title,status})));
 const nodes=useMemo(()=>JSON.parse(nodeKey) as Pick<Note,'id'|'title'|'status'>[],[nodeKey]);
 const linkKey=JSON.stringify(edges.filter(e=>nodes.some(n=>n.id===e.from)&&nodes.some(n=>n.id===e.to)).slice(0,600).map(({id,from,to})=>({id,from,to})));
 const links=useMemo(()=>JSON.parse(linkKey) as Pick<Edge,'id'|'from'|'to'>[],[linkKey]);
 useEffect(()=>{
  const element=host.current;if(!element||!nodes.length)return;
  setFailed(false);
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{setFailed(true);return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));element.prepend(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,1,.1,100);
  camera.position.set(0,2,23);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.minDistance=10;controls.maxDistance=42;controls.enablePan=false;
  const positions=nodes.map((_,i)=>{if(nodes.length===1)return new THREE.Vector3();const y=1-2*(i+.5)/nodes.length,r=Math.sqrt(1-y*y),a=i*2.399963;return new THREE.Vector3(Math.cos(a)*r*7,y*5.2,Math.sin(a)*r*5);});
  const indices=new Map(nodes.map((n,i)=>[n.id,i]));
  const glowCanvas=document.createElement('canvas');glowCanvas.width=64;glowCanvas.height=64;
  const ctx=glowCanvas.getContext('2d')!;const gradient=ctx.createRadialGradient(32,32,0,32,32,32);
  gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.15,'#ffffffbb');gradient.addColorStop(.4,'#ffffff30');gradient.addColorStop(1,'#ffffff00');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(glowCanvas);
  const geometry=new THREE.SphereGeometry(.105,12,8);
  const meshes:THREE.Mesh[]=[];const halos:THREE.Sprite[]=[];const labels:HTMLButtonElement[]=[];
  nodes.forEach((node,i)=>{
   const color=colors[node.status]||colors.candidate;
   const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color}));mesh.position.copy(positions[i]);scene.add(mesh);meshes.push(mesh);
   const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,color,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));halo.position.copy(positions[i]);halo.scale.setScalar(1.15);scene.add(halo);halos.push(halo);
   const label=document.createElement('button');label.className='neural-node-label';label.textContent=node.title;label.title=node.title;label.onclick=()=>current.current.onSelect(node.id);element.appendChild(label);labels.push(label);
  });
  const curves:THREE.QuadraticBezierCurve3[]=[];const lines:THREE.Line[]=[];const pulses:THREE.Sprite[]=[];
  links.forEach(edge=>{
   const a=positions[indices.get(edge.from)!],b=positions[indices.get(edge.to)!];
   const mid=a.clone().add(b).multiplyScalar(.5);mid.z+=a.distanceTo(b)*.18;
   const curve=new THREE.QuadraticBezierCurve3(a,mid,b);curves.push(curve);
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)),new THREE.LineBasicMaterial({color:'#6cbcac',transparent:true,opacity:.27}));scene.add(line);lines.push(line);
   const pulse=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,color:'#b6ffe7',transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));pulse.scale.setScalar(.38);scene.add(pulse);pulses.push(pulse);
  });
  let frame=0,disposed=false,inView=true,contextLost=false;
  const point=new THREE.Vector3();
  const render=(time:number)=>{
   frame=0;if(disposed||contextLost||document.hidden||!inView)return;
   camera.updateMatrixWorld();
   nodes.forEach((node,i)=>{const active=node.id===current.current.selected;meshes[i].scale.setScalar(active?1.9:1);halos[i].scale.setScalar(active?1.8:1.15);point.copy(positions[i]).project(camera);const label=labels[i];label.style.left=`${(point.x+1)*element.clientWidth/2}px`;label.style.top=`${(1-point.y)*element.clientHeight/2+14}px`;label.style.display=point.z>1||point.z< -1?'none':'';label.style.opacity=active?'1':String(.55+(1-positions[i].distanceTo(camera.position)/40)*.4);label.setAttribute('aria-pressed',String(active));});
   links.forEach((edge,i)=>{const active=edge.from===current.current.selected||edge.to===current.current.selected;(lines[i].material as THREE.LineBasicMaterial).opacity=active?.65:.22;pulses[i].visible=current.current.moving;pulses[i].position.copy(curves[i].getPoint((time*.00012+i*.173)%1));});
   renderer.render(scene,camera);element.dataset.rendered='true';
   if(current.current.moving)frame=requestAnimationFrame(render);
  };
  const draw=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(render);};
  actions.current={draw,reset:()=>{camera.position.set(0,2,23);controls.target.set(0,0,0);controls.update();draw();}};
  controls.addEventListener('change',draw);
  const resize=new ResizeObserver(()=>{const {width,height}=element.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();draw();});resize.observe(element);
  const observer=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(inView)draw();});observer.observe(element);
  document.addEventListener('visibilitychange',draw);
  let down={x:0,y:0};const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
  const pick=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);const hit=ray.intersectObjects(meshes)[0];if(hit)current.current.onSelect(nodes[meshes.indexOf(hit.object as THREE.Mesh)].id);};
  const lost=(e:Event)=>{e.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;setFailed(true);};
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pick);renderer.domElement.addEventListener('webglcontextlost',lost);
  draw();
  return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();document.removeEventListener('visibilitychange',draw);controls.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pick);scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Sprite||object instanceof THREE.Line){if('geometry' in object)object.geometry.dispose();object.material.dispose();}});texture.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();labels.forEach(label=>label.remove());actions.current={reset:()=>{},draw:()=>{}};};
 },[nodes,links]);
 useEffect(()=>{actions.current.draw();},[selected,moving]);
 return <section className="neural-graph" aria-label="3D 지식 관계 그래프">
  <div className="neural-heading"><div><span>NEURAL ATLAS</span><strong>기억이 연결되는 공간</strong></div><span className="neural-count">{nodes.length} NODES / {links.length} LINKS</span></div>
  <div className="neural-stage" ref={host} hidden={failed||!nodes.length}/>
  {(!nodes.length||failed)&&<div className="neural-fallback" role="status">{failed?'3D를 표시할 수 없습니다. 아래 기록 목록에서 탐색하세요.':'첫 기록을 남기면 지식 지도가 시작됩니다.'}</div>}
  <div className="neural-controls"><span>드래그 회전 · 스크롤 확대 · 노드 선택</span><div><button aria-label="시점 초기화" onClick={()=>actions.current.reset()}><RotateCcw size={14}/></button><button aria-label="연결 애니메이션" aria-pressed={moving} onClick={()=>setMoving(!moving)}>{moving?<Pause size={14}/>:<Play size={14}/>}</button></div></div>
  <div className="neural-legend"><span style={{color:colors.verified}}>● 확인됨</span><span style={{color:colors.candidate}}>● 검토 전</span><span style={{color:colors.stale}}>● 재검증 필요</span><span style={{color:colors.superseded}}>● 대체됨</span></div>
  <p className="neural-caption">저장된 관계만 연결합니다. 공간 배치와 빛의 흐름은 검증 수준을 뜻하지 않습니다.{notes.length>180||links.length<edges.filter(e=>nodes.some(n=>n.id===e.from)&&nodes.some(n=>n.id===e.to)).length?' 최대 180개 기록 · 600개 연결 표시. 전체 기록은 아래 목록에서 확인하세요.':''}</p>
 </section>;
}
