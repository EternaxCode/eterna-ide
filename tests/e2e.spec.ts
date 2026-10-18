import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('real UI: project, editor, knowledge graph, stale evidence, tests, persistence, mobile',async({page})=>{
 const folder=mkdtempSync(join(tmpdir(),'nexus-e2e-'));writeFileSync(join(folder,'main.js'),'export const value = 1;\n');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#token=e2e-test-token');
 await page.getByRole('button',{name:'프로젝트 추가',exact:true}).click();await page.getByLabel('프로젝트 이름').fill('브라우저 검증');await page.getByLabel('폴더의 절대 경로').fill(folder);await page.getByRole('button',{name:'프로젝트 연결',exact:true}).click();
 await page.getByRole('button',{name:'main.js',exact:true}).click();
 const editor=page.locator('.cm-content');await editor.fill('export const value = 2;\n');await page.getByRole('button',{name:'변경 비교',exact:true}).click();await expect(page.locator('.diff-view .added')).toContainText('value = 2');await page.getByRole('button',{name:'파일 저장',exact:true}).click();await expect.poll(()=>readFileSync(join(folder,'main.js'),'utf8')).toContain('value = 2');
 await page.getByRole('button',{name:'배운 점 남기기'}).click();await page.getByLabel('제목',{exact:true}).fill('검증된 입력 원칙');await page.getByLabel('내용',{exact:true}).fill('공통 지식 저장과 근거 추적을 검증합니다.');await page.locator('#note-status').selectOption('verified');await page.getByRole('button',{name:'기록 저장',exact:true}).click();
 await page.getByRole('button',{name:/지식 그래프/}).click();await expect(page.locator('.note-list')).toContainText('검증된 입력 원칙');
 await page.getByRole('button',{name:'기록 남기기',exact:true}).click();await page.getByLabel('제목',{exact:true}).fill('연결된 결정');await page.getByLabel('내용',{exact:true}).fill('첫 기록을 참고하는 결정.');await page.getByRole('button',{name:'기록 저장',exact:true}).click();
 await page.getByRole('button',{name:/연결된 결정.*배운 점/}).click();await page.getByLabel('연결할 기록').selectOption({label:'검증된 입력 원칙'});await page.getByRole('button',{name:'연결 추가',exact:true}).click();await expect(page.locator('.neural-count')).toContainText('1 LINKS');await expect(page.locator('.neural-stage')).toHaveAttribute('data-rendered','true');
 writeFileSync(join(folder,'main.js'),'export const value = 3;\n');await expect(page.locator('.note-row').filter({hasText:'검증된 입력 원칙'})).toContainText('재검증 필요');
 await page.reload();await page.getByRole('button',{name:/지식 그래프/}).click();await expect(page.locator('.note-list')).toContainText('연결된 결정');
 await page.getByRole('button',{name:'작업실',exact:true}).click();await page.getByRole('button',{name:'테스트 실행',exact:true}).click();await page.getByLabel('실행 명령',{exact:true}).fill('node -e "console.log(42)"');await page.getByRole('button',{name:'명령 실행',exact:true}).click();await expect(page.locator('.answer-heading')).toContainText('완료',{timeout:15000});await expect(page.locator('.run-output')).toContainText('42');
 await page.getByRole('button',{name:'전달할 근거 보기'}).click();await expect(page.locator('.context-preview')).not.toContainText('공통 지식 저장과 근거 추적을 검증합니다.');await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'main.js',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('value = 3');
 await page.screenshot({path:'artifacts/e2e-workspace.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('history pagination is single-flight and old workspaces remain reviewable',async({page})=>{
 const rows=Array.from({length:300},(_,i)=>({id:'run-'+i,projectId:'p',goal:'Task '+i,kind:'terminal',provider:'codex',status:'session_ended',answer:'',output:'',createdAt:'2026-10-18T00:00:00Z',workspaceId:'workspace-'+i}));
 const offsets:number[]=[];
 await page.route('**/api/state',route=>route.fulfill({json:{projects:[{id:'p',name:'Project',path:'/tmp/project'}],notes:[],edges:[],runs:rows.slice(0,100),runCount:300,workspaces:[]}}));
 await page.route('**/api/providers',route=>route.fulfill({json:[]}));
 await page.route('**/api/projects/*/files',route=>route.fulfill({json:[]}));
 await page.route('**/api/runs?offset=*',async route=>{const offset=Number(new URL(route.request().url()).searchParams.get('offset'));offsets.push(offset);await new Promise(r=>setTimeout(r,200));await route.fulfill({json:rows.slice(offset,offset+100)});});
 await page.route('**/api/runs/run-*',route=>route.fulfill({json:rows.find(r=>route.request().url().endsWith('/'+r.id))}));
 await page.goto('/#token=e2e-test-token');await page.getByRole('button',{name:'실행 기록',exact:true}).click();
 await page.getByRole('button',{name:'이전 기록 더 보기'}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect(page.locator('.run-row')).toHaveCount(200);expect(offsets).toEqual([100]);
 await page.getByRole('button',{name:'이전 기록 더 보기'}).click();await expect(page.locator('.run-row')).toHaveCount(300);expect(offsets).toEqual([100,200]);
 await page.locator('.run-row').last().click();await expect(page.getByRole('button',{name:'이 작업의 변경 검토'})).toBeVisible();
});

test('provider model selectors persist independently, reset incompatible effort, and send full access',async({page})=>{
 await page.route('**/api/models/**',route=>{const claude=route.request().url().includes('/claude');return route.fulfill({json:{source:'official-cli',models:claude?[{id:'opus-test',label:'Test Opus',efforts:['low','max']},{id:'haiku-test',label:'Test Haiku',efforts:[]}]:[{id:'gpt-test',label:'Test GPT',efforts:['low','high','ultra'],defaultEffort:'low'}]}});});
 await page.goto('/#token=e2e-test-token');
 await expect(page.getByLabel('Codex 권한',{exact:true})).toHaveValue('full');
 await page.getByLabel('Codex Model',{exact:true}).selectOption('gpt-test');await page.getByLabel('Codex Effort',{exact:true}).selectOption('ultra');
 await page.getByLabel('AI 모델 공급사').selectOption('claude');await expect(page.getByLabel('Claude 권한',{exact:true})).toHaveValue('full');
 await page.getByLabel('Claude Model',{exact:true}).selectOption('opus-test');await page.getByLabel('Claude Effort',{exact:true}).selectOption('max');
 await page.getByLabel('Claude Model',{exact:true}).selectOption('haiku-test');await expect(page.getByLabel('Claude Effort',{exact:true})).toBeDisabled();await expect(page.getByLabel('Claude Effort',{exact:true})).toHaveValue('');
 await page.getByLabel('Claude Model',{exact:true}).selectOption('opus-test');await page.getByLabel('Claude Effort',{exact:true}).selectOption('low');
 await page.reload();await expect(page.getByLabel('Codex Model',{exact:true})).toHaveValue('gpt-test');await expect(page.getByLabel('Codex Effort',{exact:true})).toHaveValue('ultra');
 await page.getByLabel('AI 모델 공급사').selectOption('claude');await expect(page.getByLabel('Claude Model',{exact:true})).toHaveValue('opus-test');await expect(page.getByLabel('Claude Effort',{exact:true})).toHaveValue('low');
 let body:any;await page.route('**/api/terminal',async route=>{body=route.request().postDataJSON();await route.fulfill({status:400,json:{error:'test: intercepted before CLI execution'}});});
 await page.getByLabel('AI 작업 요청').fill('선택 설정 전달 검증');await page.getByRole('button',{name:'AI 실행',exact:true}).click();await expect.poll(()=>body).toMatchObject({provider:'claude',model:'opus-test',effort:'low',permission:'full'});
 await page.getByRole('button',{name:'모델 연결',exact:true}).click();await page.screenshot({path:'artifacts/model-selectors.png',fullPage:true});
});

test('3D knowledge: selection, orbit, filtering, reduced motion and mobile',async({page})=>{
 const notes=Array.from({length:16},(_,i)=>({id:`n${i}`,projectId:'p',title:['입력 경계에서 검증한다','변경의 근거를 남긴다','작업 사본을 격리한다','맥락은 프로젝트에 남는다'][i%4]+` ${i+1}`,body:`기록 ${i+1}의 근거`,kind:'lesson',status:['verified','candidate','stale','superseded'][i%4],shared:false,version:1,author:'test',updatedAt:'2026-10-18T00:00:00Z'}));
 const edges=Array.from({length:22},(_,i)=>({id:`e${i}`,from:`n${i%16}`,to:`n${(i+3)%16}`,label:'참고한다'}));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/api/state',route=>route.fulfill({json:{projects:[{id:'p',name:'테스트 프로젝트',path:'/tmp/graph-fixture'}],notes,edges,runs:[]}}));
 await page.route('**/api/providers',route=>route.fulfill({json:[]}));
 await page.route('**/api/projects/*/files',route=>route.fulfill({json:[]}));
 await page.goto('/#token=e2e-test-token');await page.getByRole('button',{name:/지식 그래프/}).click();
 await expect(page.locator('.neural-stage')).toHaveAttribute('data-rendered','true');
 await expect(page.getByRole('button',{name:'연결 애니메이션'})).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('.neural-node-label')).toHaveCount(16);
 await page.locator('.neural-node-label').nth(2).focus();await page.keyboard.press('Enter');
 await expect(page.locator('.note-detail h2')).toHaveText(notes[2].title);
 const canvas=page.locator('.neural-stage canvas');const box=(await canvas.boundingBox())!;
 // Labels are interactive overlays; orbit must start on the actual canvas.
 await expect.poll(()=>page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,{x:box.x+box.width/2,y:box.y+box.height-55})).toBe('CANVAS');
 const before=await page.locator('.neural-node-label').first().getAttribute('style');
 await page.mouse.move(box.x+box.width/2,box.y+box.height-55);await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height-35,{steps:8});await page.mouse.up();
 await expect.poll(()=>page.locator('.neural-node-label').first().getAttribute('style')).not.toBe(before);
 await canvas.evaluate((el:HTMLCanvasElement)=>el.dataset.orbitCheck='persist');
 // Background state polling must preserve the existing camera and WebGL canvas.
 await page.waitForTimeout(2300);
 await expect(canvas).toHaveAttribute('data-orbit-check','persist');
 await page.getByRole('button',{name:'시점 초기화'}).click();
 await expect(page.locator('.neural-node-label').first()).toBeVisible();await page.screenshot({path:'artifacts/knowledge-3d.png',fullPage:true});
 await page.getByLabel('지식 검색').fill('없는 기록');await expect(page.locator('.neural-fallback')).toBeVisible();await expect(page.locator('.note-detail')).toContainText('기록을 선택하세요');
 await page.getByLabel('지식 검색').fill('');await expect(page.locator('.neural-node-label')).toHaveCount(16);
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'artifacts/knowledge-3d-mobile.png',fullPage:true});
 await canvas.evaluate((element:HTMLCanvasElement)=>element.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
 await expect(page.locator('.neural-fallback')).toContainText('3D를 표시할 수 없습니다');await expect(page.locator('.note-row')).toHaveCount(16);
 expect(errors).toEqual([]);
});

test('memory workflow: pin, project instructions, context budget and explicit handoff',async({page})=>{
 const folder=mkdtempSync(join(tmpdir(),'eterna-memory-ui-'));writeFileSync(join(folder,'AGENTS.md'),'Run the project tests before reporting completion.');writeFileSync(join(folder,'main.js'),'export const ok = true;');
 await page.goto('/#token=e2e-test-token');await page.getByRole('button',{name:'프로젝트 추가',exact:true}).click();await page.getByLabel('프로젝트 이름',{exact:true}).fill('메모리 검증');await page.getByLabel('폴더의 절대 경로').fill(folder);await page.getByRole('button',{name:'프로젝트 연결',exact:true}).click();
 await page.getByRole('button',{name:'배운 점 남기기'}).click();await page.getByLabel('제목',{exact:true}).fill('중요한 작업 원칙');await page.getByLabel('내용',{exact:true}).fill('검증 결과를 실제 근거와 함께 남긴다.');await page.getByRole('checkbox',{name:'중요 기억으로 고정 · 맥락 선택 우선'}).check();await page.getByRole('button',{name:'기록 저장',exact:true}).click();
 await page.getByLabel('AI 작업 요청').fill('작업 원칙에 따라 구현');await page.getByText('완료 조건 · 작업 인계',{exact:true}).click();await page.getByLabel('완료 조건',{exact:true}).fill('프로젝트 테스트 통과');await page.getByRole('button',{name:'전달할 근거 보기',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'전달할 근거',exact:true});await expect(preview.getByLabel('맥락 용량')).toContainText('64 KiB');await expect(preview.getByText('AGENTS.md',{exact:true})).toBeVisible();await expect(preview.getByText('프로젝트 테스트 통과',{exact:true})).toBeVisible();await page.screenshot({path:'artifacts/memory-context-preview.png',fullPage:true});await preview.getByRole('button',{name:'닫기',exact:true}).click();
 const state=await (await page.request.get('/api/state',{headers:{Authorization:'Bearer e2e-test-token'}})).json();const project=state.projects.find((p:any)=>p.name==='메모리 검증');const note=state.notes.find((n:any)=>n.title==='중요한 작업 원칙');expect(note.pinned).toBe(true);expect(note.status).toBe('candidate');
 const run={id:'00000000-0000-4000-8000-000000000001',projectId:project.id,goal:'중단된 구현',kind:'ai',provider:'codex',status:'timed_out',answer:'',output:'',createdAt:new Date().toISOString()};
 await page.route('**/api/state',r=>r.fulfill({json:{...state,runs:[run]}}));await page.route('**/api/runs/'+run.id,r=>r.fulfill({json:run}));await page.route('**/api/runs/'+run.id+'/handoff',r=>r.fulfill({json:{runId:run.id,projectId:project.id,goal:run.goal,acceptanceCriteria:'회귀 테스트 통과',status:run.status}}));
 await page.getByRole('button',{name:'실행 기록',exact:true}).click();await page.getByRole('button').filter({hasText:'중단된 구현'}).click();await page.getByRole('button',{name:'이 작업 이어가기',exact:true}).click();await expect(page.getByLabel('AI 작업 요청')).toHaveValue(run.goal);await expect(page.getByLabel('완료 조건',{exact:true})).toHaveValue('회귀 테스트 통과');
 let payload:any;await page.route('**/api/context',r=>{payload=r.request().postDataJSON();return r.fulfill({json:{prompt:'handoff preview',files:[],notes:[],previous:[]}});});await page.getByRole('button',{name:'전달할 근거 보기',exact:true}).click();await expect.poll(()=>payload).toMatchObject({projectId:project.id,resumeRunId:run.id,acceptanceCriteria:'회귀 테스트 통과'});
});
