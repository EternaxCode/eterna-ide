use super::*;
fn valid_folder(name: &str) -> bool {
    if name.is_empty()
        || name.chars().count() > 80
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    ![
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str())
}
impl Store {
    pub(super) fn create_project(&mut self, b: Value) -> Result<Value> {
        let name = required(&b, "name")?.trim();
        let folder = required(&b, "folderName")?;
        if name.chars().count() > 100 || name.chars().any(char::is_control) || !valid_folder(folder)
        {
            return Err("프로젝트 이름 또는 폴더 이름을 확인하세요. 경로 구분자와 예약 이름은 사용할 수 없습니다.".into());
        }
        let parent = Path::new(required(&b, "parentPath")?)
            .canonicalize()
            .map_err(|_| "상위 폴더가 없습니다. 먼저 폴더를 선택하세요.")?;
        if !parent.is_dir() {
            return Err("상위 폴더를 선택하세요.".into());
        }
        let templates: Value =
            serde_json::from_str(include_str!("../../../project-templates.json")).map_err(err)?;
        let template = required(&b, "template")?;
        let spec = templates
            .get(template)
            .ok_or("지원하지 않는 템플릿입니다.")?;
        let target = parent.join(folder);
        fs::create_dir(&target).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                "이미 같은 이름의 폴더가 있습니다. 다른 이름을 선택하거나 기존 폴더를 연결하세요."
                    .into()
            } else {
                err(e)
            }
        })?;
        let mut created: Vec<(PathBuf, Vec<u8>)> = vec![];
        let result = (|| {
            for (path, content) in spec["files"].as_object().ok_or("템플릿 형식 오류")? {
                let bytes = content
                    .as_str()
                    .ok_or("템플릿 본문 오류")?
                    .replace("{{PROJECT_NAME}}", name)
                    .into_bytes();
                let dest = target.join(path);
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o644).custom_flags(libc::O_NOFOLLOW);
                }
                let mut file = options.open(&dest).map_err(err)?;
                file.write_all(&bytes).map_err(err)?;
                file.sync_all().map_err(err)?;
                created.push((dest, bytes));
            }
            let command = if cfg!(windows) {
                spec["windowsVerificationCommand"]
                    .as_str()
                    .or(spec["verificationCommand"].as_str())
            } else {
                spec["verificationCommand"].as_str()
            }
            .unwrap_or("");
            self.create("project",json!({"name":name,"path":target,"template":template,"verificationCommand":command}))
        })();
        if result.is_err() {
            // Only remove this attempt's untouched files. Concurrent user work is never discarded.
            for (path, bytes) in created {
                if fs::symlink_metadata(&path)
                    .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
                    && fs::read(&path).is_ok_and(|current| current == bytes)
                {
                    let _ = fs::remove_file(path);
                }
            }
            let _ = fs::remove_dir(&target);
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folders_are_portable_and_cannot_escape_parent() {
        for n in [
            "..", "../x", "a/b", "a\\b", "CON", "con.txt", "LPT9", "a.", "a ", "a:b",
        ] {
            assert!(!valid_folder(n), "{n}");
        }
        assert!(valid_folder("나의-앱"));
    }
    #[test]
    fn creation_never_overwrites_existing_files() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::open(&d.path().join("data")).unwrap();
        let b = json!({"name":"새 프로젝트","folderName":"new-project","parentPath":d.path(),"template":"javascript"});
        let p = s.create_project(b.clone()).unwrap();
        let root = PathBuf::from(text(&p, "path"));
        assert!(root.join("AGENTS.md").is_file());
        assert_eq!(p["verificationCommand"], "node --test");
        fs::write(root.join("index.mjs"), "USER WORK").unwrap();
        assert!(s.create_project(b).is_err());
        assert_eq!(
            fs::read_to_string(root.join("index.mjs")).unwrap(),
            "USER WORK"
        );
    }
}
