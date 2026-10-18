import {useEffect,useRef} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
export default function TerminalPanel({ticket}:{ticket:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!ref.current)return;const term=new Terminal({fontFamily:'"SFMono-Regular", Consolas, monospace',fontSize:13,cursorBlink:true,theme:{background:'#151b1c',foreground:'#d7e1dc',cursor:'#c6e8a9'}});const fit=new FitAddon();term.loadAddon(fit);term.open(ref.current);fit.fit();const ws=new WebSocket(`ws://${location.host}/terminal?ticket=${ticket}`);ws.onmessage=e=>term.write(e.data);const size=()=>{fit.fit();if(ws.readyState===1)ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}));};ws.onopen=size;ws.onclose=()=>term.write('\r\n[연결 종료]');ws.onerror=()=>term.write('\r\n[터미널 연결 실패. 다시 열어주세요.]');const input=term.onData(data=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'input',data}));});const observer=new ResizeObserver(size);observer.observe(ref.current);return()=>{observer.disconnect();input.dispose();ws.close();term.dispose();};},[ticket]);
 return <div ref={ref} className="terminal-host" aria-label="공식 CLI 터미널"/>;
}
