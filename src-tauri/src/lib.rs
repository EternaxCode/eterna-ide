pub mod runtime;
pub mod store;

use runtime::Runtime;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use store::Store;
use tauri::{Emitter, Manager};

struct Desktop {
    store: Arc<Mutex<Store>>,
    runtime: Arc<Runtime>,
    root: PathBuf,
    smoke_report: Option<PathBuf>,
}

#[tauri::command]
async fn desktop_request(
    state: tauri::State<'_, Desktop>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let store = state.store.clone();
    let runtime = state.runtime.clone();
    let root = state.root.clone();
    let body = body.unwrap_or(Value::Null);
    tauri::async_runtime::spawn_blocking(move||{
  if path=="/desktop-info" {return Ok(json!({"native":true,"platform":std::env::consts::OS,"version":env!("CARGO_PKG_VERSION"),"dataDir":root,"smoke":std::env::var_os("ETERNA_UI_SMOKE").is_some()}));}
  if path=="/providers" {return runtime.providers();}
  if path=="/runs" && method=="POST" {return runtime.start("ai",body);}
  if path=="/tests" && method=="POST" {return runtime.start("test",body);}
  if path.starts_with("/runs/") && path.ends_with("/cancel") {return runtime.cancel(path.split('/').nth(2).unwrap_or(""));}
  if path=="/terminal" && method=="POST" {return runtime.prepare_terminal(body);}
  store.lock().map_err(|_|"저장소 잠금 실패".to_string())?.api(&method,&path,body)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn terminal_open(state: tauri::State<'_, Desktop>, ticket: String) -> Result<Value, String> {
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || runtime.open_terminal(&ticket))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn terminal_input(
    state: tauri::State<'_, Desktop>,
    ticket: String,
    data: String,
) -> Result<Value, String> {
    state.runtime.terminal_input(&ticket, &data)
}
#[tauri::command]
fn terminal_resize(
    state: tauri::State<'_, Desktop>,
    ticket: String,
    cols: u16,
    rows: u16,
) -> Result<Value, String> {
    state.runtime.terminal_resize(&ticket, cols, rows)
}
#[tauri::command]
fn terminal_close(state: tauri::State<'_, Desktop>, ticket: String) -> Result<Value, String> {
    state.runtime.terminal_close(&ticket)
}
#[tauri::command]
fn finish_smoke(
    app: tauri::AppHandle,
    state: tauri::State<'_, Desktop>,
    report: Value,
) -> Result<(), String> {
    let path = state
        .smoke_report
        .as_ref()
        .ok_or("Smoke 모드가 아닙니다.")?;
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if report["ok"] == true { 0 } else { 1 });
    Ok(())
}
#[tauri::command]
async fn save_export(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if content.len() > 128 * 1024 * 1024 {
        return Err("내보낼 내용이 너무 큽니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let choice = app
            .dialog()
            .file()
            .set_file_name(&filename)
            .add_filter("Markdown", &["md"])
            .blocking_save_file();
        if let Some(file) = choice {
            let path = file.into_path().map_err(|e| e.to_string())?;
            std::fs::write(path, content).map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
fn seed(store: &mut Store, root: &std::path::Path) -> Result<(), String> {
    let state = store.api("GET", "/state", Value::Null)?;
    if state["projects"]
        .as_array()
        .map(|x| x.is_empty())
        .unwrap_or(true)
    {
        let demo = root.join("demo");
        std::fs::create_dir_all(&demo).map_err(|e| e.to_string())?;
        std::fs::write(
            demo.join("README.md"),
            "# Eterna Desktop\n\n프로젝트를 연결하고 작업 지식을 남겨보세요.\n",
        )
        .map_err(|e| e.to_string())?;
        std::fs::write(
            demo.join("hello.js"),
            "export const greet = (name) => `안녕하세요, ${name}!`;\n",
        )
        .map_err(|e| e.to_string())?;
        store.api(
            "POST",
            "/projects",
            json!({"name":"시작 프로젝트","path":demo}),
        )?;
    }
    Ok(())
}
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|x| x == "--self-test") {
        match self_test() {
            Ok(v) => {
                if let Some(i) = args.iter().position(|a| a == "--self-test-report") {
                    if let Some(p) = args.get(i + 1) {
                        let _ = std::fs::write(p, serde_json::to_vec_pretty(&v).unwrap());
                    }
                }
                println!("{}", v);
                std::process::exit(0)
            }
            Err(e) => {
                eprintln!("{}", e);
                std::process::exit(1)
            }
        }
    }
    let smoke_report = args
        .iter()
        .position(|x| x == "--ui-smoke-report")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);
    if smoke_report.is_some() {
        std::env::set_var("ETERNA_UI_SMOKE", "1");
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_request,
            terminal_open,
            terminal_input,
            terminal_resize,
            terminal_close,
            finish_smoke,
            save_export
        ])
        .setup(move |app| {
            let root = std::env::var_os("ETERNA_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let mut db = Store::open(&root).map_err(std::io::Error::other)?;
            if let Some(path) = std::env::var_os("ETERNA_IMPORT_LEGACY") {
                db.api("POST", "/import", json!({"path":path.to_string_lossy()}))
                    .map_err(std::io::Error::other)?;
            }
            seed(&mut db, &root).map_err(std::io::Error::other)?;
            let store = Arc::new(Mutex::new(db));
            let handle = app.handle().clone();
            let emit = Arc::new(move |topic: &str, payload: Value| {
                let _ = handle.emit(topic, payload);
            });
            let runtime = Arc::new(Runtime::new(
                store.clone(),
                std::env::var_os("ETERNA_CODEX_BIN").map(PathBuf::from),
                emit,
            ));
            app.manage(Desktop {
                store,
                runtime,
                root,
                smoke_report: smoke_report.clone(),
            });
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Eterna IDE")
            .inner_size(1440., 940.)
            .min_inner_size(900., 640.)
            .on_navigation(|url| {
                url.scheme() == "tauri"
                    || url.host_str() == Some("tauri.localhost")
                    || (cfg!(debug_assertions) && url.host_str() == Some("localhost"))
            })
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Eterna 앱을 초기화하지 못했습니다.");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            handle.state::<Desktop>().runtime.shutdown();
        }
    });
}
fn self_test() -> Result<Value, String> {
    let root = std::env::temp_dir().join(format!("eterna-selftest-{}", uuid::Uuid::new_v4()));
    let mut store = Store::open(&root)?;
    seed(&mut store, &root)?;
    let state = store.api("GET", "/state", Value::Null)?;
    let project = &state["projects"][0];
    let note=store.api("POST","/notes",json!({"projectId":project["id"],"title":"자체 검증","body":"한국어 지식 보존","kind":"lesson","status":"verified","shared":false}))?;
    store.event(
        "self-test",
        "verification",
        "네이티브 저장소 검증을 완료했습니다.",
        json!([]),
    )?;
    let storage = store.api("GET", "/storage", Value::Null)?;
    drop(store);
    let mut reopened = Store::open(&root)?;
    let saved = reopened.get(note["id"].as_str().ok_or("note id")?, "note")?;
    if saved["body"] != "한국어 지식 보존" {
        return Err("저장소 복원 실패".into());
    }
    let events = reopened.api("GET", "/events?after=0", Value::Null)?;
    Ok(
        json!({"ok":true,"platform":std::env::consts::OS,"storage":storage,"events":events,"directory":root}),
    )
}
