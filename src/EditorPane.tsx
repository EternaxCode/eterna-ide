import {memo,useMemo,useEffect,useState} from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {diffLines} from 'diff';
export default memo(function EditorPane({path,original,value,diff,onChange}:{path:string;original:string;value:string;diff:boolean;onChange:(value:string)=>void}){
 const [extensions,setExtensions]=useState<NonNullable<React.ComponentProps<typeof CodeMirror>['extensions']>>([]);
 useEffect(()=>{let active=true;setExtensions([]);const load=path.endsWith('.md')?import('@codemirror/lang-markdown').then(m=>m.markdown()):path.endsWith('.py')?import('@codemirror/lang-python').then(m=>m.python()):import('@codemirror/lang-javascript').then(m=>m.javascript({jsx:true,typescript:true}));load.then(ext=>{if(active)setExtensions([ext]);}).catch(()=>{});return()=>{active=false;};},[path]);
 const changes=useMemo(()=>diff?diffLines(original,value):[],[original,value,diff]);
 return diff?<div className="diff-view">{changes.map((part,i)=><pre key={i} className={part.added?'added':part.removed?'removed':''}>{part.value}</pre>)}</div>:<CodeMirror value={value} height="100%" extensions={extensions} onChange={onChange} basicSetup={{lineNumbers:true,foldGutter:true,highlightActiveLine:true}}/>;
});
