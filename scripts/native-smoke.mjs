import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,mkdtempSync,existsSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
let exe=resolve('src-tauri/target/release/eterna-desktop'+(process.platform==='win32'?'.exe':''));
mkdirSync('artifacts',{recursive:true});
async function run(args,env,ms=90000){return new Promise((ok,fail)=>{const p=spawn(exe,args,{env:{...process.env,...env},stdio:'inherit'});const timer=setTimeout(()=>{p.kill();fail(new Error('Native process timeout'));},ms);p.on('error',e=>{clearTimeout(timer);fail(e);});p.on('exit',code=>{clearTimeout(timer);code===0?ok():fail(new Error('Native exit '+code));});});}
if(process.platform==='win32'){
 const dir=resolve('src-tauri/target/release/bundle/nsis');const installer=readdirSync(dir).find(x=>x.endsWith('.exe'));if(!installer)throw new Error('NSIS installer missing');
 const installed=join(mkdtempSync(join(tmpdir(),'eterna-install-')),'app');const buildExe=exe;exe=join(dir,installer);
 await run(['/S','/D='+installed],{},120000);const binary=readdirSync(installed).find(x=>x.endsWith('.exe')&&!x.toLowerCase().includes('uninst'));if(!binary)throw new Error('Installed executable missing');exe=join(installed,binary);
 writeFileSync('artifacts/native-install.json',JSON.stringify({ok:true,installer,installedBinary:binary}));
}
const core=resolve('artifacts/native-core.json');await run(['--self-test','--self-test-report',core],{});if(!existsSync(core)||!JSON.parse(readFileSync(core)).ok)throw new Error('Native core report missing');
const report=resolve('artifacts/native-ui.json'),data=mkdtempSync(join(tmpdir(),'eterna-native-ui-'));
await run(['--ui-smoke-report',report],{ETERNA_DATA_DIR:data},120000);const result=JSON.parse(readFileSync(report));if(!result.ok||!result.checks.webgl)throw new Error(JSON.stringify(result));console.log('Native core, real process, IPC, Korean timeline and 3D renderer verified:',result);
