export default function ContextSummary({context}:{context:any}) {
 const b=context.budget;
 return <div className="context-summary">
  <div className="context-metrics"><span>{context.files?.length||0} 파일</span><span>{context.notes?.length||0} 기억</span><span>{context.instructions?.length||0} 프로젝트 지침</span><span>{context.previous?.length||0} 이전 답변</span></div>
  {b&&<section aria-label="맥락 용량"><div className="context-budget-title"><strong>공통 맥락 {(b.promptBytes/1024).toFixed(1)} / {(b.limitBytes/1024).toFixed(0)} KiB</strong><span>UTF-8 기준 · CLI 자체 맥락은 별도</span></div><meter aria-label="맥락 사용량" min={0} max={b.limitBytes} value={b.promptBytes}/><p className="small muted">범위 내 기억 {b.eligibleNotes??context.notes.length}개 중 {context.notes.length}개 선택 · {b.omittedNotes||0}개 생략 · 파일 {b.truncatedFiles||0}개 / 기억 {b.truncatedNotes||0}개 발췌. 원문은 저장소에 보존됩니다.</p>{b.omittedPinned>0&&<p className="error">용량 제한으로 고정 기억 {b.omittedPinned}개가 빠졌습니다. 목표를 나누거나 필요한 기억을 조정하세요.</p>}{b.warnings?.map((w:string,i:number)=><p className="small error" key={i}>{w}</p>)}</section>}
  {!!context.instructions?.length&&<section><strong>프로젝트 지침</strong><ul>{context.instructions.map((f:any)=><li key={f.path}><code>{f.path}</code> · 원문 해시 확인</li>)}</ul></section>}
  {context.acceptanceCriteria&&<section><strong>완료 조건</strong><p className="note-body">{context.acceptanceCriteria}</p></section>}
  {context.checkpoint&&<section className="context-handoff"><strong>이전 작업 인계 · {context.checkpoint.status}</strong><p>{context.checkpoint.nextStep}</p>{!context.checkpoint.sourceValid&&<p>근거 또는 공유 범위가 달라 이전 답변 본문은 전달하지 않습니다.</p>}</section>}
  <details><summary>실제 전송되는 맥락 보기</summary><pre className="context-preview">{context.prompt}</pre></details>
 </div>;
}
