# Native Desktop implementation plan

Approved specification: ../specs/2026-10-18-desktop-memory-design.md
Goal: native Windows/macOS Tauri app, Rust-owned durable shared memory, official process integration, Korean observable events and 3D Synapse rendering.
Architecture: React talks to `desktop_request` IPC; Rust Store handles data/file/snapshot/context endpoints; Runtime handles official CLI/test/PTY execution. No localhost server in desktop mode. Legacy web remains runnable.

## Shared contracts

Rust methods return `Result<serde_json::Value,String>` unless noted. `Store` is behind `Arc<Mutex<Store>>`.
- `Store::open(root:&Path) -> Result<Store,String>`; root is app-data directory, never legacy .data.
- `Store::api(&mut self, method:&str, path:&str, body:Value) -> Result<Value,String>` implements the existing frontend data routes, plus POST /import {path}, GET /storage, GET /events?after=0&runId=..., POST /workspaces {projectId}.
- `Store::get(&self,id:&str,kind:&str)`, `create(&mut self,kind:&str,data:Value)`, `update(&mut self,kind:&str,id:&str,patch:Value)`.
- `Store::event(&mut self,run_id:&str,kind:&str,label:&str,refs:Value) -> Result<Value,String>` returns {id: integer sequence,runId,kind,label,refs,createdAt}. refs array objects {id,label,type}, strings supported by renderer.
- Runtime: `Runtime::new(store:Arc<Mutex<Store>>,codex:Option<PathBuf>,emit:Arc<dyn Fn(&str,Value)+Send+Sync>)`; methods providers(), start(kind:&str,body:Value), cancel(id:&str), prepare_terminal(body), open_terminal(ticket:&str), terminal_input(ticket,data), terminal_resize(ticket,cols,rows), terminal_close(ticket), shutdown(). Async work uses owned threads; short API returns immediately. Terminal events topic `eterna-terminal`, payload {ticket,data,closed?:bool}.
- `desktop_request(method,path,body)` returns same API shape as web. UI checks isTauri() and invokes it. Native file dialog is separate plugin. Desktop events route returns {events:[...],lastId}.

## Tasks / ownership

- [ ] Storage implementer: src-tauri/src/store.rs, files.rs, memory.rs, workspaces.rs as needed. Content-addressed compression, immutable event refs, non-destructive legacy import (read-only SQLite backup + manifests), path protection, optimistic writes, source staleness, existing note/graph APIs, snapshot review. Tests prove preservation/dedup/import rollback/conflicts/Korean search. No Cargo edits.
- [ ] Runtime implementer: src-tauri/src/runtime.rs only plus optional runtime submodules. Official Codex auth/read-only JSON execution and Korean observable events, Claude official PTY, cross-platform env/shell/lifecycle, no raw credential reads. Tests no live inference. No Cargo edits.
- [ ] Synapse implementer: src/SynapseView.tsx, src/synapse.css, src/synapse-layout.worker.ts only. Real-event bounded 3D graph with Korean timeline, event replay, selectable nodes, WebGL fallback and idle rendering. No synthetic events in live display. Depends on /events and existing types/api. No App.tsx/package edits.
- [ ] Integrator: Cargo/Tauri config, IPC command router, JS transport/terminal adapter, native folder/import UI, desktop packaging, fixtures and CI Windows launch/install smoke, Mac actual UI QA.
- [ ] Review: inspect each module's contracts/security, fix integration failures, run Rust tests + existing web tests + native self-test + packaging. Compare source DB before/after import. Generate checksum artifacts and report unsigned packages distinctly.

Execution rulings: preserve web .data and source tree. No credential migration. Native data lives in the OS app-data location. No confirmation loop: user approved all implementation. Publish desktop prerelease only after package tests; do not claim Windows physical-device verification from CI. Use internal deterministic core/schema for integrity; AI proposes knowledge, not arbitrary SQL. Native command surface only trusted bundled UI; no arbitrary URL navigation.
