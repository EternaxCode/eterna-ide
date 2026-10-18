use super::*;
pub(super) const LIMIT: usize = 64 * 1024;
pub(super) fn bytes_cut(s: &str, n: usize) -> String {
    let mut end = s.len().min(n);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_owned()
}
fn content_size(v: &Value) -> usize {
    text(v, "content").len()
}
pub(super) fn instruction_paths(request: &Value) -> Vec<String> {
    let mut paths = vec!["AGENTS.md".to_owned(), "CLAUDE.md".to_owned()];
    if let Some(files) = request["paths"].as_array() {
        for file in files {
            if let Some(path) = file.as_str() {
                let mut parent = Path::new(path).parent();
                let mut ancestors = vec![];
                while let Some(dir) = parent {
                    if dir.as_os_str().is_empty() {
                        break;
                    }
                    ancestors.push(dir);
                    parent = dir.parent();
                    if ancestors.len() >= 8 {
                        break;
                    }
                }
                for dir in ancestors.into_iter().rev() {
                    for name in ["AGENTS.md", "CLAUDE.md"] {
                        let p = dir.join(name).to_string_lossy().replace('\\', "/");
                        if !paths.contains(&p) {
                            paths.push(p);
                        }
                    }
                }
            }
        }
    }
    paths
}
pub(super) fn instruction_file(root: &Path, path: &str) -> (Value, Option<Value>) {
    let Ok(safe) = safe_path(root, path) else {
        return (json!("unavailable"), None);
    };
    let metadata = match fs::metadata(safe) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Value::Null, None),
        Err(_) => return (json!("unavailable"), None),
    };
    if !metadata.is_file() {
        return (json!("unavailable"), None);
    }
    if metadata.len() > 8192 {
        return (json!("oversize"), None);
    }
    match read_file(root, path) {
        Ok(f) => (f["hash"].clone(), Some(f)),
        Err(_) => (json!("unavailable"), None),
    }
}
pub(super) fn instructions_valid(root: &Path, bundle: &Value) -> bool {
    if let Some(manifest) = bundle["instructionManifest"].as_array() {
        return manifest
            .iter()
            .all(|entry| instruction_file(root, text(entry, "path")).0 == entry["hash"]);
    }
    let request = json!({"paths":bundle["files"].as_array().into_iter().flatten().map(|f|f["path"].clone()).collect::<Vec<_>>()});
    instruction_paths(&request).iter().all(|path| {
        let current = instruction_file(root, path).0;
        let previous = bundle["instructions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|f| text(f, "path") == path)
            .map(|f| f["hash"].clone())
            .unwrap_or(Value::Null);
        current == previous
    })
}
pub(super) fn prepare(project: &Value, request: &Value, mut bundle: Value) -> Result<Value> {
    let criteria = request["acceptanceCriteria"].as_str().unwrap_or("");
    if request
        .get("acceptanceCriteria")
        .is_some_and(|v| !v.is_string())
        || criteria.chars().count() > 4000
    {
        return Err("완료 조건은 4,000자 이하 문자열이어야 합니다.".into());
    }
    bundle["acceptanceCriteria"] = json!(criteria);
    let root = Path::new(text(project, "path"));
    let paths = instruction_paths(request);
    let mut instructions = vec![];
    let mut warnings = vec![];
    let mut manifest = vec![];
    for path in paths {
        let (state, file) = instruction_file(root, &path);
        manifest.push(json!({"path":path,"hash":state}));
        if state.is_null() {
            continue;
        }
        if instructions.len() >= 8 {
            warnings.push(format!("지침 수 제한: {path}"));
            continue;
        }
        match file {
            Some(f) => instructions.push(f),
            None => warnings.push(format!(
                "읽을 수 없거나 8KiB를 넘는 지침은 원문에서 확인하세요: {path}"
            )),
        }
    }
    bundle["instructionManifest"] = json!(manifest);
    bundle["instructions"] = json!(instructions);
    let initial_notes = bundle["notes"].as_array().map_or(0, Vec::len);
    let initial_files = bundle["files"].as_array().map_or(0, Vec::len);
    let initial_previous = bundle["previous"].as_array().map_or(0, Vec::len);
    for f in bundle["files"].as_array_mut().into_iter().flatten() {
        let source = text(f, "content").to_owned();
        let cut = bytes_cut(&source, 8192);
        if cut != source {
            f["truncated"] = json!(true);
            f["content"] = json!(cut);
        }
    }
    for n in bundle["notes"].as_array_mut().into_iter().flatten() {
        if n["pinned"] != true {
            let source = text(n, "body").to_owned();
            let cut = bytes_cut(&source, 4000);
            if cut != source {
                n["truncated"] = json!(true);
                n["body"] = json!(cut);
            }
        }
    }
    let mut omitted_pinned = 0;
    loop {
        bundle["provenance"]=json!(bundle["notes"].as_array().into_iter().flatten().map(|n|json!({"id":n["id"],"version":n["version"],"projectId":n["projectId"],"sourcePath":n["sourcePath"],"sourceHash":n["sourceHash"]})).collect::<Vec<_>>());
        if materialized_prompt(&bundle).len() <= LIMIT {
            break;
        }
        if let Some(previous) = bundle["previous"].as_array_mut().filter(|a| !a.is_empty()) {
            previous.pop();
            continue;
        }
        if let Some(i) = bundle["notes"]
            .as_array()
            .and_then(|a| a.iter().rposition(|n| n["pinned"] != true))
        {
            bundle["notes"].as_array_mut().unwrap().remove(i);
            continue;
        }
        if let Some(i) = bundle["files"].as_array().and_then(|a| {
            a.iter()
                .enumerate()
                .filter(|(_, f)| content_size(f) > 1024)
                .max_by_key(|(_, f)| content_size(f))
                .map(|(i, _)| i)
        }) {
            let f = &mut bundle["files"][i];
            f["content"] = json!(bytes_cut(text(f, "content"), content_size(f) / 2));
            f["truncated"] = json!(true);
            continue;
        }
        if let Some(notes) = bundle["notes"].as_array_mut().filter(|a| !a.is_empty()) {
            notes.pop();
            omitted_pinned += 1;
            continue;
        }
        if let Some(files) = bundle["files"].as_array_mut().filter(|a| !a.is_empty()) {
            files.pop();
            continue;
        }
        if let Some(instructions) = bundle["instructions"]
            .as_array_mut()
            .filter(|a| !a.is_empty())
        {
            let f = instructions.pop().unwrap();
            warnings.push(format!("맥락 예산으로 지침 생략: {}", text(&f, "path")));
            continue;
        }
        // Never silently truncate the user's goal or acceptance criteria.
        return Err("목표와 완료 조건이 64KiB 맥락 예산을 초과합니다. 요청을 줄여 주세요.".into());
    }
    bundle["budget"] = json!({"limitBytes":LIMIT,"promptBytes":materialized_prompt(&bundle).len(),"omittedNotes":initial_notes-bundle["notes"].as_array().map_or(0,Vec::len),"omittedFiles":initial_files-bundle["files"].as_array().map_or(0,Vec::len),"omittedPrevious":initial_previous-bundle["previous"].as_array().map_or(0,Vec::len),"omittedPinned":omitted_pinned,"truncatedFiles":bundle["files"].as_array().into_iter().flatten().filter(|f|f["truncated"]==true).count(),"truncatedNotes":bundle["notes"].as_array().into_iter().flatten().filter(|n|n["truncated"]==true).count(),"warnings":warnings});
    Ok(bundle)
}
