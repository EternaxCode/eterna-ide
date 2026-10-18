# Eterna Desktop 0.3.1

Windows x64와 macOS Apple Silicon용 Tauri 2 / Rust 데스크톱 버전입니다. 화면은 OS WebView에서 렌더링되며, 앱 실행에는 Node 서버나 브라우저가 필요하지 않습니다. 공식 AI CLI와 프로젝트 자체의 개발 도구는 별도로 필요합니다.

## 설치 및 실행

GitHub Releases에서 해당 OS 설치 파일을 받으세요. macOS는 DMG의 앱을 Applications로 복사하고, Windows는 NSIS 설치 프로그램을 실행합니다. 현재 베타는 Apple Developer ID 공증/Windows 상용 코드 서명이 없는 패키지입니다. 빌드·실행 검증과 OS 신뢰 서명은 구분합니다. Intel Mac 및 Windows ARM은 아직 배포 대상이 아닙니다.

## 기존 데이터 보존

`모델 연결 → 기존 데이터 가져오기`에서 기존 `.data/nexus.sqlite`를 선택하세요. 데스크톱은 새 앱 데이터 경로를 사용하며 원본 DB를 읽기 전용으로 열어 일관된 백업을 만든 다음 가져옵니다. 검증 결과와 백업 경로가 표시됩니다.

- macOS: `~/Library/Application Support/com.eternaxcode.eterna/`
- Windows: Tauri가 제공하는 사용자별 앱 데이터 폴더(앱 화면에서 정확한 위치 확인).
- 원본 DB·기존 작업 사본은 삭제하지 않습니다.
- 이미 가져온 동일 백업은 중복 반영하지 않습니다. 기존 ID와 다른 내용이 충돌하면 조용히 덮어쓰지 않습니다.
- 깊은 경로·바이너리·미적용 변경도 가져오기에서 검증합니다. 지원하지 않는 경로가 있으면 실패와 이유를 표시합니다.

## 공식 계정 연결

앱은 설치된 공식 Codex 및 Claude Code를 찾아 실행합니다. 로그인은 공식 CLI 터미널에서 합니다. API 키 환경 변수를 전달하거나 인증 토큰을 추출하지 않습니다. GPT 채팅과 Claude 터미널은 같은 공통 맥락 생성기를 사용합니다.

앱에 모든 플랫폼용 CLI/Node를 동봉하지 않아 설치 공간을 줄입니다. Windows의 Codex npm shim은 공식 패키지의 네이티브 실행 파일로 해석하며, Claude는 공식 네이티브 설치를 사용하세요. 구독 한도와 제공사 모델 권한은 그대로 적용됩니다.

여러 버전이 설치되어 있으면 `모델 연결 → Codex 실행 파일 선택`에서 공식 네이티브 실행 파일을 지정할 수 있습니다. 경로와 버전을 검증한 뒤 이 앱의 설정에만 저장하며, 시스템 전역 CLI는 바꾸지 않습니다. 진행 중인 세션이 있으면 종료한 뒤 변경하세요.

## 작업 흐름

1. 네이티브 폴더 선택으로 프로젝트를 연결합니다.
2. 제공사별 Model, Effort, 권한을 선택한 뒤 작업을 요청합니다. 기본 권한은 전체 액세스이며, Codex 채팅도 현재 프로젝트 파일을 변경하거나 명령을 실행할 수 있습니다. 제한 모드의 Codex 채팅은 읽기 전용입니다.
3. 코딩 터미널에서 별도 작업 사본을 수정합니다.
4. 변경 검토에서 파일별로 원본에 적용합니다. 다른 편집기의 변경과 충돌하면 적용하지 않습니다.
5. 작업 사본을 `저장 공간 절약 · 보관`으로 압축 객체 참조 형태로 보관하고 필요할 때 복원합니다. 실행 중인 사본은 보관할 수 없습니다.
6. `Synapse · 실행 지도`에서 실제 관측된 사건과 한국어 설명을 확인합니다.

## 저장 구조

긴 본문은 SHA-256 내용 주소의 불변 객체에 저장하고, 이득이 있는 경우 Zstandard로 압축합니다. SQLite 레코드·관계·맥락 manifest는 객체를 참조합니다. 같은 본문을 여러 실행에 넣어도 객체는 중복되지 않습니다. 생성 프롬프트는 manifest에서 재구성합니다.

사본 보관은 현재 내용을 객체로 검증·커밋한 후 앱 소유 작업 디렉터리만 회수합니다. 미적용 변경, 바이너리, 권한, 빈 디렉터리를 복원합니다. 원본 소스는 변경하지 않습니다. Git 커밋·stash·스테이징 객체가 생긴 사본은 이력을 잃지 않도록 보관/가져오기를 거절합니다. 기존 앱에서 진행 중인 작업이 있으면 먼저 완료하거나 중단해야 가져올 수 있습니다. 자동 GC나 AI에 의한 임의 기록 삭제는 구현하지 않았습니다.

검색은 범위가 제한된 한국어/코드 문자열 검색입니다. 임베딩 모델과 벡터 인덱스는 아직 추가하지 않았습니다. 전체 검색을 LLM 호출에 의존하지 않습니다.

## 실제 동작 시각화

3D 노드는 영구 실행 사건과 그 사건의 원본 참조입니다. 검색/맥락 선택, 관측된 Codex 도구 실행, 답변 생성, 테스트 시작·결과를 표시합니다. 순번·타임라인·리플레이가 같은 데이터를 사용합니다.

모델의 숨겨진 추론이나 실제 뉴런을 보여주는 화면은 아닙니다. Claude 공식 터미널은 세션 시작·종료만 관측하므로 내부 도구 순서를 추측하지 않습니다. 사용자 지식/문서를 요약한 AI 설명과 실제 도구 결과를 혼동하지 않습니다.

최대 300개 노드와 제한된 연결을 표시하고 Worker에서 배치합니다. GPU instancing을 사용하며 유휴/숨겨진 창에서는 렌더를 멈춥니다. WebGL을 사용할 수 없으면 텍스트 화면으로 작업을 이어갈 수 있습니다.

## 개발 및 검증

```sh
npm ci
npm run desktop:dev
npm run test:native
npm run test:synapse
npm run desktop:build -- --bundles app   # macOS
node scripts/native-dmg.mjs             # macOS DMG
npm run desktop:build -- --bundles nsis # Windows
node scripts/native-smoke.mjs
```

개발 시 Rust/Tauri 플랫폼 개발 도구가 필요합니다. 설치 사용자에게 Rust는 필요하지 않습니다. 네이티브 smoke는 임시 데이터 경로에서 실제 실행 파일·IPC·셸·한국어 기록·3D 렌더 프레임을 검증합니다. Windows CI는 NSIS 설치 후 설치된 실행 파일을 검사합니다. CI의 Windows 검증은 일반 사용자의 물리 PC 검증과 구분합니다.

고급 진단용 환경 변수: `ETERNA_DATA_DIR`(독립 테스트 저장소), `ETERNA_CODEX_BIN`(명시적 공식 네이티브 CLI 경로), `ETERNA_IMPORT_LEGACY`(시작 시 읽기 전용 가져오기). 이 변수로 임의의 기존 폴더를 데이터 폴더로 지정하지 마세요.

## 모델·effort·권한 선택

작업실과 모델 연결 화면의 select에서 Codex/Claude 설정을 각각 저장합니다. Codex는 공식 app-server `model/list`, Claude는 공식 CLI 초기화 응답의 `models` / `supportedEffortLevels`를 조회합니다. 임의 모델 목록을 하드코딩하지 않으며, 모델 변경 시 effort를 초기화합니다. 목록 조회는 프롬프트를 보내지 않습니다. 응답의 계정 정보나 인증 정보는 UI·DB에 저장하지 않습니다.

목록은 설치된 CLI 버전 기준이며 실행 시 계정의 모델 권한과 제공사 정책이 적용됩니다. 로그인 또는 CLI 변경 후 목록을 새로고침하세요. 조회 실패 시 공식 CLI 기본값만 사용할 수 있고, 목록에서 사라진 저장된 선택값은 다시 선택해야 합니다.

사용자 요청에 따라 양쪽 기본 권한은 전체 액세스입니다. Codex에는 `--dangerously-bypass-approvals-and-sandbox`, Claude에는 `--dangerously-skip-permissions`를 전달합니다. 제한 모드로 바꾸면 Codex 채팅은 read-only, Codex 터미널은 workspace-write/on-request, Claude는 manual로 실행합니다. OS의 폴더 접근 권한이나 관리자 정책을 변경하는 설정은 아닙니다.

근거: https://learn.chatgpt.com/docs/app-server#list-models-modellist / https://code.claude.com/docs/en/model-config 및 설치된 공식 CLI 메타데이터.
