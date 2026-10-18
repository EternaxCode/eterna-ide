import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../server/store.mjs';
import {createProject,validFolder} from '../server/projects.mjs';
test('new projects use portable paths and never overwrite existing work',()=>{
 const root=mkdtempSync(join(tmpdir(),'eterna-create-'));const store=new Store(':memory:');
 try{
  for(const folder of ['..','../escape','a/b','a\\b','CON','con.txt','LPT9','a.','a ','a:b'])assert.equal(validFolder(folder),false,folder);
  assert.equal(validFolder('나의-앱'),true);
  const input={name:'나의 앱',parentPath:root,folderName:'new-app',template:'javascript'};
  const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
  const project=createProject(store,input);assert.equal(project.verificationCommand,'node --test');
  assert.match(readFileSync(join(project.path,'README.md'),'utf8'),/나의 앱/);
  assert.match(execFileSync(process.execPath,['--test'],{cwd:project.path,encoding:'utf8',env:childEnv}),/pass 1/);
  writeFileSync(join(project.path,'index.mjs'),'USER WORK');
  assert.throws(()=>createProject(store,input),/같은 이름/);
  assert.equal(readFileSync(join(project.path,'index.mjs'),'utf8'),'USER WORK');assert.equal(store.projects().length,1);
  assert.throws(()=>createProject(store,{...input,folderName:'../escape'}));
  assert.throws(()=>createProject(store,{...input,folderName:'invalid-template',template:'unknown'}));
  assert.deepEqual(readdirSync(root),['new-app']);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('Python starter works without dependencies and failed registration rolls back only its files',()=>{
 const root=mkdtempSync(join(tmpdir(),'eterna-python-'));const store=new Store(':memory:');
 try{
  const p=createProject(store,{name:'Python 앱',parentPath:root,folderName:'python-app',template:'python'});
  execFileSync(process.platform==='win32'?'py':'python3',['-m','unittest','discover'],{cwd:p.path});
  assert.throws(()=>createProject({create(){throw new Error('db failed');}},{name:'rollback',parentPath:root,folderName:'rollback',template:'empty'}),/db failed/);
  assert.deepEqual(readdirSync(root),['python-app']);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
