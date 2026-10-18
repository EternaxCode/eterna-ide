import {useEffect,useRef} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {native} from './native';
import '@xterm/xterm/css/xterm.css';
export default function TerminalPanel({ticket}:{ticket:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!ref.current)return;let disposed=false,opened=false,ws:WebSocket|undefined,unlisten:(()=>void)|undefined;
  const term=new Terminal({fontFamily:'"SFMono-Regular", Consolas, monospace',fontSize:13,cursorBlink:true,theme:{background:'#151b1c',foreground:'#d7e1dc',cursor:'#c6e8a9'}});
  const fit=new FitAddon();term.loadAddon(fit);term.open(ref.current);fit.fit();
  const send=(type:string,payload:Record<string,unknown>)=>{if(disposed||native&&!opened)return;if(native){const command=type==='input'?'terminal_input':'terminal_resize';invoke(command,{ticket,...payload}).catch(e=>term.write('\r\n'+String(e)));}else if(ws?.readyState===1)ws.send(JSON.stringify({type,...payload}));};
  const size=()=>{if(disposed)return;fit.fit();send('resize',{cols:term.cols,rows:term.rows});};
  if(native){listen<{ticket:string;data:string;closed?:boolean}>('eterna-terminal',e=>{if(e.payload.ticket===ticket&&!disposed)term.write(e.payload.data||'');}).then(async off=>{if(disposed){off();return;}unlisten=off;await invoke('terminal_open',{ticket});if(disposed){await invoke('terminal_close',{ticket}).catch(()=>{});return;}opened=true;size();}).catch(e=>{if(!disposed)term.write('\r\n실행 실패: '+String(e));});}
  else{ws=new WebSocket(`ws://${location.host}/terminal?ticket=${ticket}`);ws.onmessage=e=>term.write(e.data);ws.onopen=size;ws.onclose=()=>{if(!disposed)term.write('\r\n[연결 종료]');};ws.onerror=()=>term.write('\r\n[터미널 연결 실패. 다시 열어주세요.]');}
  const input=term.onData(data=>send('input',{data}));const observer=new ResizeObserver(size);observer.observe(ref.current);
  return()=>{disposed=true;observer.disconnect();input.dispose();unlisten?.();if(native)invoke('terminal_close',{ticket}).catch(()=>{});else ws?.close();term.dispose();};
 },[ticket]);
 return <div ref={ref} className="terminal-host" aria-label="공식 CLI 터미널"/>;
}
