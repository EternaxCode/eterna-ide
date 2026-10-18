//! Metadata-only CLI discovery. No user turn, project files, or credentials are returned.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

pub fn normalize(provider: &str, rows: &Value) -> Vec<Value> {
    rows.as_array().into_iter().flatten().filter(|m| m["hidden"] != true && m["disabled"] != true).filter_map(|m| {
        let id=m[if provider=="codex" {"model"} else {"value"}].as_str()?;
        if id.is_empty() || id.len()>200 {return None;}
        let efforts:Vec<Value>=if provider=="codex" {
            m["supportedReasoningEfforts"].as_array().into_iter().flatten().filter_map(|e|e["reasoningEffort"].as_str()).map(|e|json!(e)).collect()
        } else if m["supportsEffort"]==true {
            m["supportedEffortLevels"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|e|json!(e)).collect()
        } else {vec![]};
        Some(json!({"id":id,"label":m["displayName"].as_str().unwrap_or(id),"description":m["description"].as_str().unwrap_or(""),"efforts":efforts,"defaultEffort":m["defaultReasoningEffort"].as_str().unwrap_or(""),"isDefault":m["isDefault"]==true || id=="default"}))
    }).collect()
}

pub fn discover(mut command: Command, provider: &str) -> Result<Value, String> {
    if provider == "codex" {
        command.args(["--disable", "hooks", "--disable", "plugins", "app-server"]);
    } else {
        command.args([
            "--safe-mode",
            "--print",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--no-session-persistence",
        ]);
    }
    command
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("CLI 입력 연결 실패")?;
    let output = child.stdout.take().ok_or("CLI 출력 연결 실패")?;
    let (tx, rx) = mpsc::sync_channel(64);
    thread::spawn(move || {
        for line in BufReader::new(output.take(2_000_000)).lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let result = (|| {
        let write = |input: &mut std::process::ChildStdin, v: Value| -> Result<(), String> {
            writeln!(input, "{v}").map_err(|e| e.to_string())?;
            input.flush().map_err(|e| e.to_string())
        };
        write(
            &mut input,
            if provider == "codex" {
                json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"eterna","version":"0.3.1"}}})
            } else {
                json!({"type":"control_request","request_id":"eterna-models","request":{"subtype":"initialize"}})
            },
        )?;
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut models = vec![];
        let mut pages = 0;
        loop {
            let line = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| {
                    "모델 목록 조회 시간 초과. 공식 CLI 로그인과 연결을 확인하세요.".to_string()
                })?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if provider == "codex" {
                if v["id"] == 1 {
                    if !v["error"].is_null() {
                        return Err("Codex 초기화 실패".into());
                    }
                    write(&mut input, json!({"method":"initialized"}))?;
                    write(
                        &mut input,
                        json!({"id":2,"method":"model/list","params":{"limit":100,"includeHidden":false}}),
                    )?;
                } else if v["id"] == 2 {
                    if !v["error"].is_null() {
                        return Err("Codex 모델 목록 조회 실패".into());
                    }
                    models.extend(normalize(provider, &v["result"]["data"]));
                    pages += 1;
                    if let Some(cursor) =
                        v["result"]["nextCursor"].as_str().filter(|s| !s.is_empty())
                    {
                        if pages >= 10 {
                            return Err("모델 목록 페이지 제한 초과".into());
                        }
                        write(
                            &mut input,
                            json!({"id":2,"method":"model/list","params":{"limit":100,"cursor":cursor,"includeHidden":false}}),
                        )?;
                    } else {
                        break;
                    }
                }
            } else if v["type"] == "control_response"
                && v["response"]["request_id"] == "eterna-models"
            {
                if v["response"]["subtype"] != "success" {
                    return Err("Claude 모델 목록 조회 실패".into());
                }
                models = normalize(provider, &v["response"]["response"]["models"]);
                break;
            }
        }
        if models.is_empty() {
            return Err("공식 CLI가 선택 가능한 모델을 반환하지 않았습니다.".into());
        }
        Ok(
            json!({"provider":provider,"models":models,"source":"official-cli","checkedAt":chrono::Utc::now().to_rfc3339()}),
        )
    })();
    drop(input);
    drop(rx);
    super::runtime::kill_tree(child.id());
    let _ = child.wait();
    result
}

pub fn validate(catalog: &Value, model: &str, effort: &str) -> Result<(), String> {
    if model.is_empty() {
        return if effort.is_empty() {
            Ok(())
        } else {
            Err("effort를 선택하려면 모델을 먼저 선택하세요.".into())
        };
    }
    let m = catalog["models"]
        .as_array()
        .and_then(|a| a.iter().find(|m| m["id"] == model))
        .ok_or("현재 CLI 목록에 없는 모델입니다. 목록을 새로고침하세요.")?;
    if !effort.is_empty()
        && !m["efforts"]
            .as_array()
            .is_some_and(|a| a.iter().any(|e| e == effort))
    {
        return Err("선택한 모델이 지원하지 않는 effort입니다.".into());
    }
    Ok(())
}

pub fn flags(
    provider: &str,
    model: &str,
    effort: &str,
    permission: &str,
    interactive: bool,
) -> Result<Vec<String>, String> {
    let mut args = vec![];
    match (provider, permission) {
        ("codex", "full") => args.push("--dangerously-bypass-approvals-and-sandbox".into()),
        ("codex", "restricted") => {
            args.extend([
                "--sandbox".into(),
                if interactive {
                    "workspace-write"
                } else {
                    "read-only"
                }
                .into(),
            ]);
            if interactive {
                args.extend(["--ask-for-approval".into(), "on-request".into()]);
            }
        }
        ("claude", "full") => args.push("--dangerously-skip-permissions".into()),
        ("claude", "restricted") => args.extend(["--permission-mode".into(), "manual".into()]),
        _ => return Err("지원하지 않는 권한 모드입니다.".into()),
    }
    if !model.is_empty() {
        args.extend(["--model".into(), model.into()]);
    }
    if !effort.is_empty() {
        if provider == "codex" {
            args.extend([
                "-c".into(),
                format!("model_reasoning_effort={}", json!(effort)),
            ]);
        } else {
            args.extend(["--effort".into(), effort.into()]);
        }
    }
    Ok(args)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_specific_efforts_and_hidden_models() {
        let m = normalize(
            "codex",
            &json!([{"model":"a","supportedReasoningEfforts":[{"reasoningEffort":"high"}]},{"model":"hidden","hidden":true}]),
        );
        let c = json!({"models":m});
        assert!(validate(&c, "a", "high").is_ok());
        assert!(validate(&c, "a", "ultra").is_err());
        assert!(validate(&c, "hidden", "").is_err());
        assert!(validate(&c, "", "high").is_err());
    }
    #[test]
    fn claude_no_effort_model_and_account_data_not_exposed() {
        let m = normalize(
            "claude",
            &json!([{"value":"haiku","account":{"email":"private"}},{"value":"opus","supportsEffort":true,"supportedEffortLevels":["low","max"]}]),
        );
        assert_eq!(m[0]["efforts"], json!([]));
        assert!(m[0]["account"].is_null());
        assert_eq!(m[1]["efforts"], json!(["low", "max"]));
    }
    #[test]
    fn full_and_restricted_flags_are_exclusive() {
        for p in ["codex", "claude"] {
            let f = flags(p, "a", "high", "full", true).unwrap();
            assert!(f.iter().any(|s| s.contains("dangerously")));
            assert!(!f.contains(&"--sandbox".into()));
            assert!(!f.contains(&"manual".into()));
            let r = flags(p, "a", "high", "restricted", true).unwrap();
            assert!(!r.iter().any(|s| s.contains("dangerously")));
        }
        assert!(flags("codex", "", "", "oops", false).is_err());
    }
}
