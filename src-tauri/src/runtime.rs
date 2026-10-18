//! Official CLI subprocess boundary. Credentials stay exclusively with the official tools.
use crate::store::Store;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

type ResultValue = Result<Value, String>;
type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;
const OUTPUT_LIMIT: usize = 60_000;
const STREAM_LIMIT: usize = 20_000_000;
#[derive(Clone)]
pub struct Runtime {
    inner: Arc<Inner>,
}
struct Inner {
    store: Arc<Mutex<Store>>,
    codex: Option<PathBuf>,
    emit: Emit,
    active: Mutex<HashMap<String, Active>>,
    tickets: Mutex<HashMap<String, Ticket>>,
    opening: Mutex<HashMap<String, Arc<AtomicBool>>>,
    shutting_down: AtomicBool,
    terminals: Mutex<HashMap<String, Terminal>>,
}
struct Active {
    pid: u32,
    project: String,
    stop: Arc<AtomicBool>,
}
struct Ticket {
    created: Instant,
    provider: String,
    action: String,
    cwd: PathBuf,
    project: String,
    context: Value,
    workspace: Value,
    model: String,
}
struct Terminal {
    pid: Option<u32>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    stop: Arc<AtomicBool>,
}
fn strv<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn required(v: &Value, key: &str) -> Result<String, String> {
    let s = strv(v, key);
    if s.is_empty() {
        Err(format!("{key} 값이 필요합니다."))
    } else {
        Ok(s.to_owned())
    }
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "실행 상태 잠금 오류".into()
}

/// Allowlist rather than deleting known secrets: unknown provider credentials cannot leak.
fn clean_env() -> Vec<(String, String)> {
    let mut env = Vec::new();
    for key in [
        "HOME",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "SystemRoot",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "USER",
        "LOGNAME",
        "SHELL",
    ] {
        if let Ok(v) = std::env::var(key) {
            env.push((key.into(), v));
        }
    }
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let h = PathBuf::from(home);
        for p in [
            h.join(".local/bin"),
            h.join(".cargo/bin"),
            h.join("AppData/Roaming/npm"),
        ] {
            if !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    for p in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        let p = PathBuf::from(p);
        if !paths.contains(&p) {
            paths.push(p);
        }
    }
    if let Ok(path) = std::env::join_paths(paths) {
        env.push(("PATH".into(), path.to_string_lossy().into()));
    }
    env.push(("TERM".into(), "xterm-256color".into()));
    env
}
/// Resolve npm launch shims to their adjacent official native payload on Windows.
/// No shell command text is constructed; a .cmd/.ps1 shim is never executed with prompts.
#[cfg(any(windows, test))]
fn windows_native_candidate(id: &str, candidate: &Path, arch: &str) -> Option<PathBuf> {
    if !candidate.is_file() {
        return None;
    }
    if candidate
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        && candidate.is_file()
    {
        return candidate.canonicalize().ok();
    }
    if id != "codex" {
        return None;
    }
    let (package, triple) = match arch {
        "aarch64" => ("codex-win32-arm64", "aarch64-pc-windows-msvc"),
        "x86_64" => ("codex-win32-x64", "x86_64-pc-windows-msvc"),
        _ => return None,
    };
    for base in candidate.parent()?.ancestors().take(4) {
        for modules in [base.join("node_modules"), base.to_path_buf()] {
            for root in [
                modules.join("@openai").join(package),
                modules
                    .join("@openai/codex/node_modules/@openai")
                    .join(package),
                modules.join("@openai/codex"),
            ] {
                for binary in ["bin/codex.exe", "codex/codex.exe"] {
                    let path = root.join("vendor").join(triple).join(binary);
                    if path.is_file() {
                        return path.canonicalize().ok();
                    }
                }
            }
        }
    }
    None
}
fn command(bin: &Path) -> Command {
    let mut c = Command::new(bin);
    c.env_clear().envs(clean_env());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}
fn kill_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags_no_window()
            .status();
    }
}
#[cfg(windows)]
trait HiddenCommand {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}
#[cfg(windows)]
impl HiddenCommand for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x08000000)
    }
}
fn tail_append(dest: &mut String, text: &str, limit: usize) {
    dest.push_str(text);
    if dest.len() > limit {
        let mut cut = dest.len() - limit;
        while !dest.is_char_boundary(cut) {
            cut += 1;
        }
        dest.drain(..cut);
    }
}
fn spawn_reader<R: Read + Send + 'static>(
    mut read: R,
    channel: mpsc::SyncSender<(bool, Vec<u8>)>,
    err: bool,
) {
    thread::spawn(move || {
        let mut buf = [0; 8192];
        loop {
            match read.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if channel.send((err, buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });
}
fn capture(bin: &Path, args: &[&str], timeout: Duration) -> Result<(bool, String), String> {
    capture_cancellable(bin, args, timeout, None)
}
fn capture_cancellable(
    bin: &Path,
    args: &[&str],
    timeout: Duration,
    stop: Option<&AtomicBool>,
) -> Result<(bool, String), String> {
    if stop.is_some_and(|s| s.load(Ordering::SeqCst)) {
        return Err("터미널 열기가 취소되었습니다.".into());
    }
    let mut child = command(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::sync_channel(16);
    spawn_reader(child.stdout.take().unwrap(), tx.clone(), false);
    spawn_reader(child.stderr.take().unwrap(), tx, true);
    let start = Instant::now();
    let mut out = String::new();
    loop {
        if stop.is_some_and(|s| s.load(Ordering::SeqCst)) {
            kill_tree(child.id());
            let _ = child.wait();
            return Err("터미널 열기가 취소되었습니다.".into());
        }
        while let Ok((_, bytes)) = rx.try_recv() {
            tail_append(&mut out, &String::from_utf8_lossy(&bytes), OUTPUT_LIMIT);
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            kill_tree(child.id());
            for (_, bytes) in rx.iter() {
                tail_append(&mut out, &String::from_utf8_lossy(&bytes), OUTPUT_LIMIT);
            }
            return Ok((status.success(), out));
        }
        if start.elapsed() > timeout {
            kill_tree(child.id());
            let _ = child.wait();
            return Err("공식 CLI 응답 시간 초과".into());
        }
        thread::sleep(Duration::from_millis(20));
    }
}
fn codex_args(model: &str) -> Vec<String> {
    let mut args: Vec<String> = [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--sandbox",
        "read-only",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if !model.is_empty() {
        args.extend(["--model".into(), model.into()]);
    }
    args.push("-".into());
    args
}

fn failure(text: &str) -> &'static str {
    let s = text.to_lowercase();
    if ["usage limit", "rate limit", "quota", "429"]
        .iter()
        .any(|x| s.contains(x))
    {
        "limited"
    } else if ["not logged", "unauthorized", "authentication", "401"]
        .iter()
        .any(|x| s.contains(x))
    {
        "auth_required"
    } else {
        "failed"
    }
}
impl Runtime {
    pub fn new(store: Arc<Mutex<Store>>, codex: Option<PathBuf>, emit: Emit) -> Self {
        Self {
            inner: Arc::new(Inner {
                store,
                codex,
                emit,
                active: Mutex::new(HashMap::new()),
                tickets: Mutex::new(HashMap::new()),
                opening: Mutex::new(HashMap::new()),
                shutting_down: AtomicBool::new(false),
                terminals: Mutex::new(HashMap::new()),
            }),
        }
    }
    fn binary(&self, id: &str) -> Result<PathBuf, String> {
        if id == "codex" {
            if let Some(p) = &self.inner.codex {
                // Resolve relative overrides before changing the subprocess working directory.
                let absolute = p
                    .canonicalize()
                    .map_err(|e| format!("설정된 Codex 실행 파일을 확인하세요: {e}"))?;
                #[cfg(windows)]
                {
                    return windows_native_candidate(id, &absolute, std::env::consts::ARCH)
                        .ok_or_else(|| {
                            "설정된 Codex 경로에서 공식 native .exe를 찾지 못했습니다.".into()
                        });
                }
                #[cfg(not(windows))]
                {
                    return Ok(absolute);
                }
            }
        }
        let path = clean_env()
            .into_iter()
            .find(|(k, _)| k == "PATH")
            .map(|(_, v)| v);
        #[cfg(windows)]
        {
            if let Some(path) = &path {
                // Prefer official native installations even when npm shims occur earlier on PATH.
                let dirs: Vec<_> = std::env::split_paths(path).collect();
                for dir in &dirs {
                    if let Some(exe) = windows_native_candidate(
                        id,
                        &dir.join(format!("{id}.exe")),
                        std::env::consts::ARCH,
                    ) {
                        return Ok(exe);
                    }
                }
                for dir in &dirs {
                    for suffix in ["cmd", "ps1"] {
                        let shim = dir.join(format!("{id}.{suffix}"));
                        if shim.is_file() {
                            if let Some(exe) =
                                windows_native_candidate(id, &shim, std::env::consts::ARCH)
                            {
                                return Ok(exe);
                            }
                        }
                    }
                }
            }
            Err(format!("{id} 공식 native CLI 설치가 필요합니다. npm 셸 래퍼만 있는 설치는 지원하지 않습니다."))
        }
        #[cfg(not(windows))]
        {
            which::which_in(id, path, std::env::current_dir().unwrap_or_default())
                .map_err(|_| format!("{id} 공식 CLI 설치가 필요합니다."))?
                .canonicalize()
                .map_err(|e| e.to_string())
        }
    }

    fn provider(&self, id: &str) -> Value {
        let Ok(bin) = self.binary(id) else {
            return json!({"id":id,"installed":false,"connected":false,"label":"CLI 설치 필요"});
        };
        let version = capture(&bin, &["--version"], Duration::from_secs(5));
        let Ok((true, version)) = version else {
            return json!({"id":id,"installed":false,"connected":false,"label":"CLI 실행 확인 실패"});
        };
        let args = if id == "codex" {
            vec!["login", "status"]
        } else {
            vec!["auth", "status"]
        };
        let (ok, text) =
            capture(&bin, &args, Duration::from_secs(8)).unwrap_or((false, String::new()));
        let connected = ok
            && if id == "codex" {
                text.to_lowercase().contains("logged in using chatgpt")
            } else {
                serde_json::from_str::<Value>(&text)
                    .map(|v| v["loggedIn"] == true && v["authMethod"] == "claude.ai")
                    .unwrap_or(false)
            };
        json!({"id":id,"installed":true,"connected":connected,"version":version.trim(),"label":if connected {if id=="codex"{"ChatGPT 구독 연결"}else{"Claude 구독 연결"}}else{"구독 로그인 필요"},"mode":if id=="codex"{"chat-and-terminal"}else{"official-terminal"},"remaining":null})
    }
    pub fn providers(&self) -> ResultValue {
        Ok(json!([self.provider("codex"), self.provider("claude")]))
    }
    fn ensure_login(&self, provider: &str) -> Result<(), String> {
        if self.provider(provider)["connected"] == true {
            Ok(())
        } else {
            Err(
                "먼저 모델 연결에서 공식 구독 계정으로 로그인하세요. API 인증은 사용하지 않습니다."
                    .into(),
            )
        }
    }
    fn event(&self, id: &str, kind: &str, label: &str, refs: Value) {
        if let Ok(mut s) = self.inner.store.lock() {
            let _ = s.event(id, kind, label, refs);
        }
    }
    pub fn start(&self, kind: &str, body: Value) -> ResultValue {
        if !["ai", "test"].contains(&kind) {
            return Err("지원하지 않는 실행 종류".into());
        }
        let project = required(&body, "projectId")?;
        if kind == "ai" {
            self.ensure_login("codex")?;
        }
        let mut active = self.inner.active.lock().map_err(lock_error)?;
        if active.values().any(|a| a.project == project) {
            return Err("이 프로젝트에서 이미 실행 중입니다.".into());
        }
        let mut store = self.inner.store.lock().map_err(lock_error)?;
        let p = store.get(&project, "project")?;
        let context = if kind == "ai" {
            store.api("POST", "/context", body.clone())?
        } else {
            Value::Null
        };
        let cmd = if kind == "test" {
            required(&body, "command")?
        } else {
            String::new()
        };
        let mut process = if kind == "ai" {
            let mut c = command(&self.binary("codex")?);
            c.args(codex_args(strv(&body, "model")));
            c
        } else {
            shell_command(&cmd)
        };
        process
            .current_dir(required(&p, "path")?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = process.spawn().map_err(|e| format!("실행 실패: {e}"))?;
        let run=match store.create("run",json!({"projectId":project,"goal":strv(&body,"goal"),"kind":kind,"provider":if kind=="ai"{"codex"}else{"local"},"status":"running","answer":"","output":"","contextId":context["id"],"command":cmd})) {Ok(v)=>v,Err(e)=>{kill_tree(child.id());let _=child.wait();return Err(e)}};
        let id = required(&run, "id")?;
        let stop = Arc::new(AtomicBool::new(false));
        active.insert(
            id.clone(),
            Active {
                pid: child.id(),
                project,
                stop: stop.clone(),
            },
        );
        drop(store);
        drop(active);
        self.event(&id, "run.started", "실행을 시작했습니다.", json!([]));
        if kind == "ai" {
            self.event(
                &id,
                "context.delivered",
                "선택한 공통 자료를 Codex에 전달했습니다.",
                json!([{ "id":context["id"],"type":"context","label":"공통 작업 자료"}]),
            )
        }
        let prompt = strv(&context, "prompt").to_owned();
        if let Some(mut stdin) = child.stdin.take() {
            thread::spawn(move || {
                let _ = stdin.write_all(prompt.as_bytes());
            });
        }
        let rt = self.clone();
        let kind = kind.to_owned();
        thread::spawn(move || rt.watch(child, id, kind, stop));
        Ok(run)
    }
    fn watch(
        &self,
        mut child: std::process::Child,
        id: String,
        kind: String,
        stop: Arc<AtomicBool>,
    ) {
        let (tx, rx) = mpsc::sync_channel(32);
        spawn_reader(child.stdout.take().unwrap(), tx.clone(), false);
        spawn_reader(child.stderr.take().unwrap(), tx, true);
        let mut output = String::new();
        let mut answer = String::new();
        let mut line = Vec::new();
        let mut error = String::new();
        let mut success = false;
        let mut bytes = 0;
        let start = Instant::now();
        let mut pulse = Instant::now();
        let mut reason = String::new();
        let mut exited = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(30)) {
                Ok((stderr, data)) => {
                    bytes += data.len();
                    if stderr || kind == "test" {
                        tail_append(&mut output, &String::from_utf8_lossy(&data), OUTPUT_LIMIT);
                    } else {
                        line.extend(data);
                        while let Some(pos) = line.iter().position(|b| *b == b'\n') {
                            let chunk: Vec<u8> = line.drain(..=pos).collect();
                            self.codex_event(
                                &id,
                                &chunk,
                                &mut answer,
                                &mut output,
                                &mut error,
                                &mut success,
                            );
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if exited.is_some() {
                        break;
                    }
                }
                Err(_) => {}
            }
            if reason.is_empty() {
                reason = if stop.load(Ordering::SeqCst) {
                    "cancelled"
                } else if start.elapsed()
                    > Duration::from_secs(if kind == "test" { 120 } else { 180 })
                {
                    "timed_out"
                } else if bytes > STREAM_LIMIT || line.len() > 2_000_000 {
                    "output_limit"
                } else {
                    ""
                }
                .into();
                if !reason.is_empty() {
                    kill_tree(child.id());
                }
            }
            if exited.is_none() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        exited = Some(status);
                        kill_tree(child.id());
                    }
                    Err(e) => {
                        error = e.to_string();
                        kill_tree(child.id());
                        exited = child.wait().ok();
                        if exited.is_none() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            if pulse.elapsed() > Duration::from_millis(500) {
                if let Ok(mut s) = self.inner.store.lock() {
                    let _ = s.update("run", &id, json!({"answer":answer,"output":output}));
                }
                pulse = Instant::now();
            }
        }
        if !line.is_empty() {
            self.codex_event(
                &id,
                &line,
                &mut answer,
                &mut output,
                &mut error,
                &mut success,
            );
        }
        let good = exited.as_ref().map(|s| s.success()).unwrap_or(false)
            && (kind == "test" || success)
            && error.is_empty();
        let status = if !reason.is_empty() {
            reason.as_str()
        } else if good {
            "completed"
        } else {
            failure(&format!("{error} {output}"))
        };
        if let Ok(mut s) = self.inner.store.lock() {
            let _=s.update("run",&id,json!({"answer":answer,"output":output,"status":status,"error":if good{Value::Null}else{json!(if error.is_empty(){format!("{status}: 실행 로그를 확인하세요.")}else{error})},"exitCode":exited.and_then(|s|s.code()),"finishedAt":chrono::Utc::now().to_rfc3339()}));
        }
        self.event(
            &id,
            if kind == "test" {
                "test.finished"
            } else {
                "run.finished"
            },
            if status == "completed" {
                "실행이 완료되었습니다."
            } else {
                "실행이 중단되었거나 실패했습니다. 결과를 확인하세요."
            },
            json!([{ "id":id,"type":"run","label":status}]),
        );
        if let Ok(mut active) = self.inner.active.lock() {
            active.remove(&id);
        }
    }
    fn codex_event(
        &self,
        id: &str,
        line: &[u8],
        answer: &mut String,
        output: &mut String,
        error: &mut String,
        success: &mut bool,
    ) {
        let Ok(e) = serde_json::from_slice::<Value>(line) else {
            tail_append(output, &String::from_utf8_lossy(line), OUTPUT_LIMIT);
            return;
        };
        let item = &e["item"];
        match strv(&e, "type") {
            "turn.completed" => *success = true,
            "turn.failed" | "error" => {
                *error = e["error"]["message"]
                    .as_str()
                    .or(e["message"].as_str())
                    .unwrap_or("AI 실행 실패")
                    .to_owned();
                self.event(
                    id,
                    "run.error",
                    "공식 CLI가 오류를 보고했습니다.",
                    json!([]),
                );
            }
            "item.completed" if item["type"] == "agent_message" => {
                if !answer.is_empty() {
                    answer.push_str("\n\n");
                }
                tail_append(answer, strv(item, "text"), OUTPUT_LIMIT);
                self.event(id, "answer.created", "AI 답변이 생성되었습니다.", json!([]));
            }
            "item.started" | "item.completed" => {
                let done = e["type"] == "item.completed";
                let (kind, label, refs) = match strv(item, "type") {
                    "command_execution" => (
                        "tool.command",
                        if done {
                            "명령 실행 결과가 도착했습니다."
                        } else {
                            "명령을 실행하고 있습니다."
                        },
                        json!([{ "id":item["id"],"type":"tool","label":strv(item,"command")}]),
                    ),
                    "file_change" => (
                        "file.changed",
                        "CLI가 파일 변경을 보고했습니다.",
                        Value::Array(
                            item["changes"]
                                .as_array()
                                .unwrap_or(&Vec::new())
                                .iter()
                                .filter_map(|c| {
                                    c["path"]
                                        .as_str()
                                        .map(|p| json!({"id":p,"type":"file","label":p}))
                                })
                                .collect(),
                        ),
                    ),
                    "mcp_tool_call" => (
                        "tool.call",
                        if done {
                            "도구 호출 결과가 도착했습니다."
                        } else {
                            "도구를 호출하고 있습니다."
                        },
                        json!([{ "id":item["id"],"type":"tool","label":strv(item,"tool")}]),
                    ),
                    "web_search" => (
                        "search.observed",
                        "CLI가 웹 검색을 보고했습니다.",
                        json!([]),
                    ),
                    _ => return, // Never expose reasoning items or infer hidden file reads.
                };
                if done && item["type"] == "command_execution" {
                    tail_append(output, strv(item, "aggregated_output"), OUTPUT_LIMIT);
                }
                self.event(id, kind, label, refs);
            }
            _ => {}
        }
    }
    pub fn cancel(&self, id: &str) -> ResultValue {
        if let Some(a) = self.inner.active.lock().map_err(lock_error)?.get(id) {
            a.stop.store(true, Ordering::SeqCst);
            kill_tree(a.pid);
        }
        self.inner.store.lock().map_err(lock_error)?.get(id, "run")
    }
    pub fn prepare_terminal(&self, body: Value) -> ResultValue {
        let provider = required(&body, "provider")?;
        if !["codex", "claude"].contains(&provider.as_str()) {
            return Err("지원하지 않는 제공사".into());
        }
        self.binary(&provider)?;
        let action = body["action"].as_str().unwrap_or("work").to_string();
        if !["login", "work"].contains(&action.as_str()) {
            return Err("지원하지 않는 작업".into());
        }
        if action == "work" {
            self.ensure_login(&provider)?;
        }
        let project = required(&body, "projectId")?;
        let mut tickets = self.inner.tickets.lock().map_err(lock_error)?;
        tickets.retain(|_, t| t.created.elapsed() < Duration::from_secs(30));
        if tickets.len() >= 30 {
            return Err("터미널 요청이 너무 많습니다.".into());
        }
        let mut s = self.inner.store.lock().map_err(lock_error)?;
        let p = s.get(&project, "project")?;
        let context = if action == "work" {
            s.api("POST", "/context", body.clone())?
        } else {
            Value::Null
        };
        let workspace = if action == "work" {
            s.api("POST", "/workspaces", json!({"projectId":project}))?
        } else {
            Value::Null
        };
        let cwd = PathBuf::from(required(
            if action == "work" { &workspace } else { &p },
            "path",
        )?);
        if action == "work" {
            let dir = cwd.join(".nexus");
            if std::fs::symlink_metadata(&dir)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err("맥락 폴더는 심볼릭 링크일 수 없습니다.".into());
            }
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let file = dir.join("context.md");
            if std::fs::symlink_metadata(&file)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err("맥락 파일은 심볼릭 링크일 수 없습니다.".into());
            }
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
            }
            options
                .open(file)
                .and_then(|mut f| f.write_all(strv(&context, "prompt").as_bytes()))
                .map_err(|e| e.to_string())?;
        }
        let ticket = uuid::Uuid::new_v4().to_string();
        let result = json!({"ticket":ticket,"contextId":context["id"],"workspace":if workspace.is_null(){Value::Null}else{json!({"id":workspace["id"],"skipped":workspace["skipped"]})}});
        tickets.insert(
            ticket,
            Ticket {
                created: Instant::now(),
                provider,
                action,
                cwd,
                project,
                context,
                workspace,
                model: strv(&body, "model").into(),
            },
        );
        Ok(result)
    }
    pub fn open_terminal(&self, ticket: &str) -> ResultValue {
        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut opening = self.inner.opening.lock().map_err(lock_error)?;
            if self.inner.shutting_down.load(Ordering::SeqCst) {
                return Err("앱이 종료 중입니다.".into());
            }
            if opening.contains_key(ticket) {
                return Err("터미널을 이미 열고 있습니다.".into());
            }
            opening.insert(ticket.to_owned(), stop.clone());
        }
        let result = self.open_reserved_terminal(ticket, stop);
        if let Ok(mut opening) = self.inner.opening.lock() {
            opening.remove(ticket);
        }
        result
    }
    fn open_reserved_terminal(&self, ticket: &str, stop: Arc<AtomicBool>) -> ResultValue {
        let t = self
            .inner
            .tickets
            .lock()
            .map_err(lock_error)?
            .remove(ticket)
            .ok_or("터미널 요청이 없거나 이미 사용되었습니다.")?;
        if t.created.elapsed() > Duration::from_secs(30) {
            return Err("터미널 요청이 만료되었습니다.".into());
        }
        let bin = self.binary(&t.provider)?;
        let mut cmd = CommandBuilder::new(&bin);
        cmd.env_clear();
        for (k, v) in clean_env() {
            cmd.env(k, v);
        }
        cmd.cwd(&t.cwd);
        if t.action == "login" {
            if t.provider == "codex" {
                cmd.arg("login");
            } else {
                cmd.args(["auth", "login", "--claudeai"]);
            }
        } else {
            if t.provider == "codex" {
                cmd.args([
                    "--disable",
                    "hooks",
                    "--disable",
                    "plugins",
                    "-c",
                    "model_provider=\"openai\"",
                    "--ask-for-approval",
                    "on-request",
                    "--sandbox",
                    "workspace-write",
                ]);
                if !t.model.is_empty() {
                    cmd.args(["--model", &t.model]);
                }
                let (ok, text) = capture_cancellable(
                    &bin,
                    &[
                        "--disable",
                        "plugins",
                        "--disable",
                        "hooks",
                        "mcp",
                        "list",
                        "--json",
                    ],
                    Duration::from_secs(8),
                    Some(&stop),
                )?;
                if !ok {
                    return Err("Codex 외부 도구 설정을 확인하지 못했습니다.".into());
                }
                let servers: Vec<Value> =
                    serde_json::from_str(&text).map_err(|_| "Codex 외부 도구 설정 응답 오류")?;
                for server in servers {
                    let name = strv(&server, "name");
                    if name.is_empty()
                        || !name
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                    {
                        return Err("외부 도구 이름을 안전하게 비활성화할 수 없습니다.".into());
                    }
                    cmd.arg("-c");
                    cmd.arg(format!("mcp_servers.{name}.enabled=false"));
                }
            } else {
                cmd.args(["--safe-mode", "--permission-mode", "manual"]);
            }
            cmd.arg("먼저 .nexus/context.md를 읽으세요. 공통 자료와 사용자 목표를 확인하고 작업 사본에서 수행하세요. 원본 경로를 찾아 수정하지 마세요. 결과를 한국어로 설명하세요.");
        }
        // Serialize the final check, process spawn, and live-session publication with close/shutdown.
        let opening_guard = self.inner.opening.lock().map_err(lock_error)?;
        if stop.load(Ordering::SeqCst) || self.inner.shutting_down.load(Ordering::SeqCst) {
            return Err("터미널 열기가 취소되었습니다.".into());
        }
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 28,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let streams = pair
            .master
            .try_clone_reader()
            .and_then(|reader| pair.master.take_writer().map(|writer| (reader, writer)));
        let (reader, writer) = match streams {
            Ok(v) => v,
            Err(e) => {
                if let Some(pid) = child.process_id() {
                    kill_tree(pid)
                }
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.to_string());
            }
        };
        let run = if t.action == "work" {
            match self.inner.store.lock().map_err(lock_error)?.create("run",json!({"projectId":t.project,"kind":"terminal","provider":t.provider,"status":"running","goal":t.context["goal"],"contextId":t.context["id"],"workspaceId":t.workspace["id"],"answer":"","output":"공식 CLI 터미널 세션. 내부 도구 호출은 관측되지 않음. 화면 출력은 자동 저장하지 않습니다."})){Ok(v)=>Some(v),Err(e)=>{if let Some(pid)=child.process_id(){kill_tree(pid)}let _=child.kill();let _=child.wait();return Err(e)}}
        } else {
            None
        };
        let id = run.as_ref().map(|r| strv(r, "id").to_string());
        if let Some(id) = &id {
            self.event(
                id,
                "terminal.started",
                "공식 터미널이 시작되었습니다. 내부 도구 호출은 관측되지 않습니다.",
                json!([]),
            );
        }
        self.inner.terminals.lock().map_err(lock_error)?.insert(
            ticket.into(),
            Terminal {
                pid: child.process_id(),
                writer,
                master: pair.master,
                stop: stop.clone(),
            },
        );
        drop(opening_guard);
        let (tx, rx) = mpsc::sync_channel(32);
        spawn_reader(reader, tx, false);
        let rt = self.clone();
        let ticket = ticket.to_string();
        thread::spawn(move || {
            let start = Instant::now();
            let mut bytes = 0;
            let mut ended = None;
            let mut utf8 = Vec::new();
            loop {
                match rx.recv_timeout(Duration::from_millis(30)) {
                    Ok((_, data)) => {
                        bytes += data.len();
                        utf8.extend(data);
                        let valid = match std::str::from_utf8(&utf8) {
                            Ok(_) => utf8.len(),
                            Err(e) => e.valid_up_to(),
                        };
                        if valid > 0 {
                            let data = String::from_utf8_lossy(&utf8[..valid]).to_string();
                            utf8.drain(..valid);
                            (rt.inner.emit)(
                                "eterna-terminal",
                                json!({"ticket":ticket,"data":data}),
                            );
                        }
                        if utf8.len() > 4 {
                            (rt.inner.emit)(
                                "eterna-terminal",
                                json!({"ticket":ticket,"data":String::from_utf8_lossy(&utf8)}),
                            );
                            utf8.clear();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        if ended.is_some() {
                            break;
                        }
                    }
                    _ => {}
                }
                if stop.load(Ordering::SeqCst)
                    || bytes > STREAM_LIMIT
                    || start.elapsed() > Duration::from_secs(7200)
                {
                    if let Some(pid) = child.process_id() {
                        kill_tree(pid)
                    }
                    let _ = child.kill();
                }
                if ended.is_none() {
                    match child.try_wait() {
                        Ok(Some(s)) => {
                            ended = Some(s.exit_code());
                            if let Some(pid) = child.process_id() {
                                kill_tree(pid)
                            }
                        }
                        Err(_) => {
                            let _ = child.kill();
                            ended = Some(1);
                        }
                        _ => {}
                    }
                }
            }
            if let Some(id) = id {
                if let Ok(mut s) = rt.inner.store.lock() {
                    let _=s.update("run",&id,json!({"status":if stop.load(Ordering::SeqCst){"cancelled"}else{"session_ended"},"exitCode":ended,"finishedAt":chrono::Utc::now().to_rfc3339()}));
                }
                rt.event(
                    &id,
                    "terminal.closed",
                    "공식 터미널 세션이 종료되었습니다.",
                    json!([]),
                );
            }
            if let Ok(mut ts) = rt.inner.terminals.lock() {
                ts.remove(&ticket);
            }
            (rt.inner.emit)(
                "eterna-terminal",
                json!({"ticket":ticket,"data":"\r\n[세션 종료]\r\n","closed":true}),
            );
        });
        Ok(json!({"opened":true}))
    }
    pub fn terminal_input(&self, ticket: &str, data: &str) -> ResultValue {
        if data.len() > 65536 {
            return Err("입력 크기 제한 초과".into());
        }
        let mut ts = self.inner.terminals.lock().map_err(lock_error)?;
        let t = ts.get_mut(ticket).ok_or("종료된 터미널입니다.")?;
        t.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        t.writer.flush().map_err(|e| e.to_string())?;
        Ok(json!({"ok":true}))
    }
    pub fn terminal_resize(&self, ticket: &str, cols: u16, rows: u16) -> ResultValue {
        let ts = self.inner.terminals.lock().map_err(lock_error)?;
        let t = ts.get(ticket).ok_or("종료된 터미널입니다.")?;
        t.master
            .resize(PtySize {
                cols: cols.clamp(20, 300),
                rows: rows.clamp(5, 100),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        Ok(json!({"ok":true}))
    }
    pub fn terminal_close(&self, ticket: &str) -> ResultValue {
        let opening = self.inner.opening.lock().map_err(lock_error)?;
        if let Some(stop) = opening.get(ticket) {
            stop.store(true, Ordering::SeqCst);
        }

        if let Some(t) = self.inner.terminals.lock().map_err(lock_error)?.get(ticket) {
            t.stop.store(true, Ordering::SeqCst);
            if let Some(pid) = t.pid {
                kill_tree(pid);
            }
        }
        self.inner
            .tickets
            .lock()
            .map_err(lock_error)?
            .remove(ticket);
        Ok(json!({"ok":true}))
    }
    pub fn shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::SeqCst);
        if let Ok(opening) = self.inner.opening.lock() {
            for stop in opening.values() {
                stop.store(true, Ordering::SeqCst);
            }
        }

        if let Ok(active) = self.inner.active.lock() {
            for a in active.values() {
                a.stop.store(true, Ordering::SeqCst);
                kill_tree(a.pid);
            }
        }
        if let Ok(ts) = self.inner.terminals.lock() {
            for t in ts.values() {
                t.stop.store(true, Ordering::SeqCst);
                if let Some(pid) = t.pid {
                    kill_tree(pid);
                }
            }
        }
        // Give cancellable preflight helpers time to reap before the desktop event loop exits.
        let until = Instant::now() + Duration::from_millis(500);
        while Instant::now() < until {
            if self
                .inner
                .opening
                .lock()
                .map(|p| p.is_empty())
                .unwrap_or(true)
            {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}
fn shell_command(script: &str) -> Command {
    #[cfg(windows)]
    {
        let shell = std::env::var_os("COMSPEC").unwrap_or_else(|| "cmd.exe".into());
        let mut c = command(Path::new(&shell));
        c.args(["/D", "/S", "/C", script]);
        c
    }
    #[cfg(not(windows))]
    {
        let shell = if cfg!(target_os = "macos") {
            Path::new("/bin/zsh")
        } else {
            Path::new("/bin/sh")
        };
        let mut c = command(shell);
        c.args(["-c", script]);
        c
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observable_events_exclude_private_reasoning() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Mutex::new(Store::open(dir.path()).unwrap()));
        let rt = Runtime::new(store.clone(), None, Arc::new(|_, _| {}));
        let mut answer = String::new();
        let mut output = String::new();
        let mut error = String::new();
        let mut success = false;
        for value in [
            json!({"type":"item.completed","item":{"type":"reasoning","text":"PRIVATE_REASONING"}}),
            json!({"type":"item.completed","item":{"type":"command_execution","id":"tool-1","command":"echo verified","aggregated_output":"verified","exit_code":0}}),
            json!({"type":"item.completed","item":{"type":"agent_message","text":"완료했습니다."}}),
            json!({"type":"turn.completed"}),
        ] {
            rt.codex_event(
                "fake-run",
                &serde_json::to_vec(&value).unwrap(),
                &mut answer,
                &mut output,
                &mut error,
                &mut success,
            );
        }
        assert!(success);
        assert_eq!(answer, "완료했습니다.");
        assert_eq!(output, "verified");
        let events = store
            .lock()
            .unwrap()
            .api("GET", "/events?after=0", Value::Null)
            .unwrap();
        assert!(!events.to_string().contains("PRIVATE_REASONING"));
        assert!(events.to_string().contains("tool.command"));
    }
    #[test]
    fn local_test_run_persists_native_shell_result() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("project");
        std::fs::create_dir(&project_dir).unwrap();
        let store = Arc::new(Mutex::new(Store::open(&dir.path().join("data")).unwrap()));
        let project = store
            .lock()
            .unwrap()
            .api(
                "POST",
                "/projects",
                json!({"name":"test","path":project_dir}),
            )
            .unwrap();
        let rt = Runtime::new(store.clone(), None, Arc::new(|_, _| {}));
        let run = rt
            .start(
                "test",
                json!({"projectId":project["id"],"command":"echo native-result"}),
            )
            .unwrap();
        let start = Instant::now();
        loop {
            let result = store.lock().unwrap().get(strv(&run, "id"), "run").unwrap();
            if result["status"] != "running" {
                assert_eq!(result["status"], "completed");
                assert!(strv(&result, "output").contains("native-result"));
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(25));
        }
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_persists_and_ends_child_process() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("project");
        std::fs::create_dir(&project_dir).unwrap();
        let store = Arc::new(Mutex::new(Store::open(&dir.path().join("data")).unwrap()));
        let project = store
            .lock()
            .unwrap()
            .api(
                "POST",
                "/projects",
                json!({"name":"test","path":project_dir}),
            )
            .unwrap();
        let rt = Runtime::new(store.clone(), None, Arc::new(|_, _| {}));
        let run = rt
            .start(
                "test",
                json!({"projectId":project["id"],"command":"sleep 30 & wait"}),
            )
            .unwrap();
        let id = strv(&run, "id");
        let pid = rt.inner.active.lock().unwrap().get(id).unwrap().pid;
        rt.cancel(id).unwrap();
        let start = Instant::now();
        loop {
            let result = store.lock().unwrap().get(id, "run").unwrap();
            if result["status"] != "running" {
                assert_eq!(result["status"], "cancelled");
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(3));
            thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
    #[test]
    fn native_pty_can_launch_and_deliver_output() {
        let pair = native_pty_system()
            .openpty(PtySize {
                cols: 80,
                rows: 24,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        #[cfg(unix)]
        let mut cmd = CommandBuilder::new("/bin/sh");
        #[cfg(unix)]
        cmd.args(["-c", "echo pty-native-result"]);
        #[cfg(windows)]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)]
        cmd.args(["/D", "/C", "echo pty-native-result"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let (tx, rx) = mpsc::sync_channel(4);
        spawn_reader(pair.master.try_clone_reader().unwrap(), tx, false);
        let start = Instant::now();
        let mut output = String::new();
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok((_, data)) = rx.recv_timeout(Duration::from_millis(50)) {
                output.push_str(&String::from_utf8_lossy(&data));
                if output.contains("pty-native-result") {
                    break;
                }
            }
        }
        if let Some(pid) = child.process_id() {
            kill_tree(pid)
        }
        let _ = child.kill();
        let _ = child.wait();
        assert!(output.contains("pty-native-result"));
    }
    #[cfg(unix)]
    #[test]
    fn fake_official_cli_auth_json_and_answer_roundtrip() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("project");
        std::fs::create_dir(&project_dir).unwrap();
        let bin = dir.path().join("fake-codex");
        std::fs::write(
            &bin,
            r#"#!/bin/sh
case "$1" in
--version) echo 'codex-cli fake';;
login) echo 'Logged in using ChatGPT';;
exec) cat >/dev/null
 echo '{"type":"item.completed","item":{"type":"reasoning","text":"PRIVATE"}}'
 echo '{"type":"item.completed","item":{"type":"agent_message","text":"검증 완료"}}'
 echo '{"type":"turn.completed"}';;
esac
"#,
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o700)).unwrap();
        let store = Arc::new(Mutex::new(Store::open(&dir.path().join("data")).unwrap()));
        let project = store
            .lock()
            .unwrap()
            .api(
                "POST",
                "/projects",
                json!({"name":"test","path":project_dir}),
            )
            .unwrap();
        let rt = Runtime::new(store.clone(), Some(bin), Arc::new(|_, _| {}));
        let run = rt
            .start(
                "ai",
                json!({"projectId":project["id"],"goal":"검증","paths":[],"includeShared":false}),
            )
            .unwrap();
        let start = Instant::now();
        loop {
            let result = store.lock().unwrap().get(strv(&run, "id"), "run").unwrap();
            if result["status"] != "running" {
                assert_eq!(result["status"], "completed");
                assert_eq!(result["answer"], "검증 완료");
                assert!(!result.to_string().contains("PRIVATE"));
                assert!(result["contextId"].is_string());
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(25));
        }
    }
    #[cfg(unix)]
    #[test]
    fn close_and_shutdown_cancel_terminal_during_preflight_before_spawn() {
        use std::os::unix::fs::PermissionsExt;
        for shutdown in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let bin = dir.path().join("fake-codex");
            std::fs::write(
                &bin,
                r#"#!/bin/sh
base=$(dirname "$0")
case " $* " in
*" mcp "*) touch "$base/entered"
while [ ! -f "$base/release" ]; do sleep 0.01; done
echo '[]';;
*) touch "$base/spawned";;
esac
"#,
            )
            .unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o700)).unwrap();
            let store = Arc::new(Mutex::new(Store::open(&dir.path().join("data")).unwrap()));
            let rt = Runtime::new(store, Some(bin), Arc::new(|_, _| {}));
            rt.inner.tickets.lock().unwrap().insert(
                "ticket".into(),
                Ticket {
                    created: Instant::now(),
                    provider: "codex".into(),
                    action: "work".into(),
                    cwd: dir.path().into(),
                    project: "project".into(),
                    context: json!({"id":"context"}),
                    workspace: json!({"id":"workspace"}),
                    model: String::new(),
                },
            );
            let opener = rt.clone();
            let handle = thread::spawn(move || opener.open_terminal("ticket"));
            let start = Instant::now();
            while !dir.path().join("entered").exists() {
                assert!(start.elapsed() < Duration::from_secs(3));
                thread::sleep(Duration::from_millis(5));
            }
            // The ticket has been consumed and preflight is blocked, but the reservation must remain cancellable.
            assert!(!rt.inner.tickets.lock().unwrap().contains_key("ticket"));
            if shutdown {
                rt.shutdown();
            } else {
                rt.terminal_close("ticket").unwrap();
            }
            std::fs::write(dir.path().join("release"), "").unwrap();
            assert!(handle.join().unwrap().unwrap_err().contains("취소"));
            assert!(!dir.path().join("spawned").exists());
            assert!(rt.inner.opening.lock().unwrap().is_empty());
            assert!(rt.inner.terminals.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn windows_npm_shims_resolve_only_matching_native_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("codex.cmd");
        std::fs::write(&shim, "untrusted shell wrapper").unwrap();
        assert!(windows_native_candidate("codex", &shim, "x86_64").is_none());
        let native = dir.path().join(
            "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        );
        std::fs::create_dir_all(native.parent().unwrap()).unwrap();
        std::fs::write(&native, "fixture only").unwrap();
        assert_eq!(
            windows_native_candidate("codex", &shim, "x86_64"),
            Some(native.canonicalize().unwrap())
        );
        assert!(windows_native_candidate("codex", &shim, "aarch64").is_none());
        assert!(windows_native_candidate("claude", &shim, "x86_64").is_none());
        let claude = dir.path().join("claude.exe");
        std::fs::write(&claude, "fixture only").unwrap();
        assert_eq!(
            windows_native_candidate("claude", &claude, "x86_64"),
            Some(claude.canonicalize().unwrap())
        );
    }
    #[test]
    fn windows_nested_npm_optional_dependency_payload_is_found() {
        let dir = tempfile::tempdir().unwrap();
        let modules = dir.path().join("node_modules");
        let shim = modules.join(".bin/codex.cmd");
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        std::fs::write(&shim, "fixture").unwrap();
        let native=modules.join("@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/codex/codex.exe");
        std::fs::create_dir_all(native.parent().unwrap()).unwrap();
        std::fs::write(&native, "fixture").unwrap();
        assert_eq!(
            windows_native_candidate("codex", &shim, "aarch64"),
            Some(native.canonicalize().unwrap())
        );
    }
    #[test]
    fn credentials_are_not_forwarded() {
        let env = clean_env();
        assert!(!env
            .iter()
            .any(|(k, _)| k.contains("API_KEY") || k.contains("TOKEN")));
        assert!(env.iter().any(|(k, _)| k == "PATH"));
    }
    #[test]
    fn native_shell_executes_real_command() {
        let out = shell_command("echo eterna-native-shell").output().unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("eterna-native-shell"));
    }
    #[test]
    fn tail_preserves_utf8() {
        let mut s = String::new();
        tail_append(&mut s, "한글출력테스트", 10);
        assert!(s.len() <= 10);
        assert!(s.ends_with("스트"));
    }
    #[test]
    fn read_only_cli_contract() {
        let args = codex_args("");
        assert!(args.contains(&"--ignore-user-config".into()));
        assert!(args.contains(&"read-only".into()));
        assert!(!args.contains(&"--dangerously-bypass-approvals-and-sandbox".into()));
    }
    #[cfg(unix)]
    #[test]
    fn timeout_kills_process_group() {
        let start = Instant::now();
        let result = capture(
            Path::new("/bin/sh"),
            &["-c", "sleep 30 & wait"],
            Duration::from_millis(100),
        );
        assert!(result.is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
