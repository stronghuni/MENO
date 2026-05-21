# MENO

대면 회의를 자동으로 회의록화하는 macOS 데스크톱 앱.

**녹음 → 한국어 전사 → 화자 분리 → 회의록 작성 → Notion 업로드** — 음성 처리·전사·요약 전 과정이 로컬에서 돌고, 외부로 나가는 데이터는 사용자가 켠 경우의 Notion 업로드뿐입니다. 그리고 모든 회의록에 대해 자연어로 질문할 수 있는 **로컬 LLM 채팅** 이 내장돼 있습니다.

<p align="center">
  <img src="resources/icon.png" alt="MENO" width="128" />
</p>

---

## 주요 기능

- **로컬 STT** — Whisper Large-v3 Turbo로 한국어 정밀 전사 (Metal GPU 가속)
- **자동 화자 분리** — pyannote + 3D-Speaker 임베딩으로 SPK1/SPK2… 라벨
- **회의록 자동 작성** — Qwen2.5-7B로 안건/논의/결정/액션 표준 포맷 산출. 장문은 map-reduce로 처리
- **녹음 일시정지 / 재개**, 라우트 이동해도 살아있는 백그라운드 세션
- **Notion 자동 업로드** — 부모 페이지 아래 자식 페이지로 회의록 추가
- **회의록 챗봇** — 모든 회의록 또는 선택한 회의록에 대해 자연어 질문, 마크다운 응답
- **밝은/어두운 테마**, macOS 네이티브 vibrancy 사이드바, squircle 도크 아이콘

---

## 1. 사전 준비

| 요구사항 | 버전 |
|---|---|
| macOS | 12 (Monterey) 이상 — Apple Silicon 권장 |
| Node.js | **20.x 또는 22.x LTS** ([nvm](https://github.com/nvm-sh/nvm) 권장) |
| npm | 10 이상 |
| 디스크 여유 | 모델 다운로드용 약 **8GB** + 녹음 저장용 여유 |
| Xcode Command Line Tools | `xcode-select --install` (네이티브 모듈 빌드용) |

> Node.js 23 등 odd-numbered 버전은 `better-sqlite3` ABI 충돌이 잦습니다. 가능하면 22 LTS 사용을 권장합니다.

---

## 2. 클론 & 설치

```bash
# 1. 저장소 클론
git clone https://github.com/stronghuni/MENO.git
cd MENO

# 2. 의존성 설치 (네이티브 모듈 자동 빌드 포함)
npm install

# 3. Electron의 ABI에 맞춰 네이티브 모듈 재빌드 (필요시)
npx @electron/rebuild

# 4. 개발 모드 실행
npm run dev
```

설치 중 `smart-whisper`, `sherpa-onnx-node`, `better-sqlite3`, `keytar` 네이티브 빌드가 진행됩니다 (1~3분). `postinstall` 훅이 `electron-builder install-app-deps`를 자동으로 호출해 Electron ABI에 맞춥니다.

설치가 ABI 에러로 실패할 경우:
```bash
npm install --ignore-scripts
npx @electron/rebuild -f -w better-sqlite3
npx @electron/rebuild -f -w smart-whisper
npx @electron/rebuild -f -w keytar
```

---

## 3. 첫 실행 — 모델 다운로드

`npm run dev`로 앱이 뜨면 **첫 실행 온보딩 오버레이**가 자동으로 모델 4개를 병렬 다운로드합니다 (총 약 6.3GB, 1회만, 진행률 표시):

| 모델 | 용량 | 용도 |
|---|---|---|
| `Whisper Large-v3 Turbo (GGML)` | 1.6GB | 한국어 전사 |
| `Qwen2.5-7B-Instruct Q4_K_M (GGUF)` | 4.7GB | 회의록 작성 + 채팅 |
| `pyannote segmentation-3.0 (ONNX)` | 6MB | 화자 분리 segmentation |
| `3D-Speaker eres2net base (ONNX)` | 40MB | 화자 임베딩 |

저장 위치 (변경 불가):
```
~/Library/Application Support/meeting-notes/models/
```

> 다운로드 중 끊겨도 다시 실행하면 이어 받습니다 (idempotent). HuggingFace 미러를 사용하므로 별도 토큰 불필요.

---

## 4. Notion 연동 (선택)

회의록을 자동으로 Notion에 올리려면:

1. **Internal Integration 생성**
   [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration** → 이름·워크스페이스 선택 → **Internal** 선택 → 토큰 복사 (`secret_...`)

2. **부모 페이지 권한 부여**
   회의록을 모아둘 Notion 페이지 (예: "회의록 보관함")를 열고:
   `⋯ 메뉴 → Connections → 방금 만든 Integration 선택`
   → 그 페이지와 모든 하위 페이지에 통합이 접근 가능해집니다.

3. **앱 설정 입력**
   MENO **설정 화면** → Integration Token 붙여넣기 → **Keychain에 저장**
   → 드롭다운에서 **부모 페이지** 선택 → 자동 업로드 토글 ON

토큰은 macOS Keychain에 저장됩니다 (앱 파일에는 평문 저장 안 함).

> 통합에 페이지 권한을 안 주면 드롭다운이 비어 있습니다. 다시 한번 부모 페이지의 Connections를 확인하세요.

---

## 5. 사용

### 새 회의 녹음
1. 사이드바 **새 회의** 클릭
2. 제목, 날짜·시작 시간 (`datetime-local` 피커), 참여자 (콤마로 chip 입력) 입력
3. 마이크 장치 선택 → **녹음 시작**
4. 녹음 화면은 도트 그리드 파형 애니메이션 (마이크 레벨에 반응). ⏸ 일시정지 / ⏵ 재개 / **회의 종료** 버튼
5. 종료 누르면 자동으로 파이프라인:
   ```
   전사 → 화자 분리 → 회의록 작성 → (자동) Notion 업로드
   ```
   1시간 회의 ≈ M 시리즈 기준 약 8~12분 처리

### 회의 상세
- 좌측 패널: 화자별 색상 구분된 **전사본**
- 우측 패널: **회의록** (마크다운 렌더, "편집" 버튼으로 textarea 토글)
- 상단: 제목 더블클릭으로 수정, ← 화살표로 라이브러리 복귀, **Notion에 업로드** 버튼, ⋯ 메뉴 (오디오 파일 열기, MD 내보내기, 다시 처리, 삭제)

### 채팅 — 회의록 어시스턴트
- 사이드바 **채팅** 클릭
- 빈 상태에서 캡슐 형태 추천 질문이 3초마다 스르륵 바뀜
- 입력창의 **+ 버튼** 으로 특정 회의들 선택 → 그 범위 안에서만 답변. 미선택 시 **모든 회의록** 대상
- Qwen 2.5가 회의록 컨텍스트로 응답 (마크다운 표·인용·헤딩 모두 렌더)
- 회의와 무관한 질문은 "회의록과 관련된 질문에만 답해드릴 수 있습니다." 한 줄로 거절
- 대화는 영속화 (앱 재시작해도 유지). 헤더에서 **대화 초기화** 가능

### 라이브러리
- 카드 그리드, 회의별 상태 배지 (녹음 완료 / 회의록 / Notion 업로드됨)
- 카드 호버 시 체크박스 노출 → **다중 선택 + 일괄 삭제**

---

## 6. 데이터 위치

| 자료 | 경로 |
|---|---|
| SQLite DB | `~/Library/Application Support/meeting-notes/meetings.db` |
| 원본 오디오 (WAV) | `~/Library/Application Support/meeting-notes/recordings/<id>.wav` |
| 모델 | `~/Library/Application Support/meeting-notes/models/` |
| 채팅 history | `~/Library/Application Support/meeting-notes/chat.json` |
| 앱 설정 (테마, 자동 업로드 등) | `~/Library/Application Support/meeting-notes/settings.json` |
| Notion 토큰 | macOS Keychain (`io.namuneulbo.meetingnotes / notion.token`) |

> 앱 이름은 MENO지만 데이터 디렉터리는 `meeting-notes`로 유지됩니다 (이름 변경 시 기존 사용자의 데이터 보존).

---

## 7. 개발

```bash
npm run dev          # Electron + Vite HMR + dev HTTP bridge (:9877)
npm run typecheck    # tsconfig.node + tsconfig.web
npm test             # vitest (단위 테스트)
npm run lint         # eslint
npm run format       # prettier
npm run build        # 프로덕션 빌드 (out/)
npm run build:mac    # macOS .dmg (arm64 + x64) + .zip 둘 다
```

### 디버깅
- 렌더러 DevTools: `Cmd+Option+I`
- 메인 프로세스 로그: `npm run dev`의 stdout
- HTTP 브리지: 개발 모드에서 `http://127.0.0.1:9877/healthz` 응답 → 모든 IPC를 브라우저(`http://localhost:5173`)에서 호출 가능

### E2E
```bash
node scripts/integration-test.mjs   # 순수 JS 단위 검증 (WAV, merger, prompts 등)
```
브리지가 살아있는 동안 Python 스크립트로 채팅·녹음 전체를 시뮬레이션할 수 있습니다 (`scripts/` 참조).

---

## 8. 아키텍처

```
src/
├─ main/                          Node 메인 프로세스
│  ├─ index.ts                    앱 부트스트랩 / 윈도우 / 종료 핸들러
│  ├─ ipc.ts                      IPC 라우터 (Electron + dev HTTP 브리지 공용)
│  ├─ handlers.ts                 채널 → 핸들러 매핑 (33 채널)
│  ├─ devBridge.ts                개발용 HTTP+SSE 브리지 (:9877)
│  ├─ menu.ts                     macOS 표준 메뉴
│  ├─ services/
│  │  ├─ storage.ts               SQLite (meetings 테이블 + 마이그레이션)
│  │  ├─ recording.ts             WAV 작성 / 일시정지 / 워치독
│  │  ├─ wavWriter.ts             16-bit PCM WAV writer
│  │  ├─ wavReader.ts             WAV → Float32Array decoder
│  │  ├─ transcriber.ts           smart-whisper 래퍼 (패치된 binding)
│  │  ├─ diarizer.ts              sherpa-onnx 래퍼
│  │  ├─ summarizer.ts            node-llama-cpp + Qwen 공유 모델
│  │  ├─ chat.ts                  채팅 세션 (요약과 모델 공유)
│  │  ├─ processor.ts             종료 후 파이프라인 오케스트레이션
│  │  ├─ notion.ts                Notion API (페이지 모드)
│  │  ├─ keychain.ts              macOS Keychain
│  │  ├─ settings.ts              JSON 설정
│  │  └─ downloader.ts            HuggingFace 모델 다운로드 (이어받기)
│  └─ domain/
│     ├─ merger.ts                전사 + 화자 매칭 (순수 함수)
│     └─ prompts.ts               표준 회의록 프롬프트 + 청크 분할
├─ preload/
│  └─ index.ts                    contextBridge로 `window.api` 노출
└─ renderer/src/
   ├─ App.tsx                     HashRouter + RecordingProvider
   ├─ contexts/RecordingContext.tsx  App-level 마이크 세션
   ├─ components/                 Sidebar / WaveformPulse / AttendeesInput / ErrorBoundary
   ├─ routes/                     NewMeeting / Chat / Library / MeetingDetail / Settings
   ├─ hooks/useMicrophone.ts      마이크 캡처 (16kHz mono PCM)
   ├─ lib/api.ts                  window.api 안전 접근 (Electron / 브라우저)
   └─ styles/                     tokens.css + app.css
```

---

## 9. 디자인 결정

| 결정 | 이유 |
|---|---|
| Electron + React/TS | 크로스플랫폼 + React 생태계 |
| 순수 Node 네이티브 (Python sidecar 없음) | 배포 단순화 |
| Whisper Large-v3 Turbo + Metal | 한국어 정확도와 속도 균형 |
| Qwen2.5-7B Q4_K_M | 한국어 품질 + RAM ≤6GB |
| Map-reduce 요약 | 1시간+ 회의도 컨텍스트 한도 내 처리 |
| 종료 후 한 번에 전사 | 녹음 중 LLM 호출 0 → 안정성 + 배터리 |
| Notion 페이지 모드 (DB 모드 X) | DB 만들 필요 없이 페이지 권한만 |
| Keychain | 토큰 평문 저장 회피 |
| SQLite + WAV 파일 | 검색 가능 + 외부 도구 접근 가능 |
| `userData` 경로 고정 (`meeting-notes`) | 앱 이름 변경에도 데이터 보존 |

---

## 10. 패키징 & 배포

```bash
npm run build:mac
```

`dist/` 아래에 다음이 생성됩니다:
- `MENO-0.1.0-arm64.dmg` (Apple Silicon)
- `MENO-0.1.0-x64.dmg` (Intel)
- `MENO-0.1.0-arm64-mac.zip`
- `MENO-0.1.0-x64-mac.zip`

코드사인·노타라이즈는 **Apple Developer 계정 ($99/년)** 이 필요합니다. 미공증 빌드는 받는 사람이 **우클릭 → 열기** 로 Gatekeeper 우회해야 합니다.

서명을 설정하려면 `electron-builder.yml`에 다음 추가:
```yaml
mac:
  notarize: true
  identity: "Developer ID Application: Your Name (TEAM_ID)"
```

---

## 11. 알려진 제약

- 화자 분리 정확도는 마이크 1개 환경에서 약 80% — 회의 상세에서 수동 보정 가능
- 회의 1시간 처리 시 메모리 피크 ≈ 8GB (Whisper + Qwen 동시 로드 구간)
- `node-llama-cpp`는 첫 추론 시 플랫폼 바이너리 자동 감지/다운로드 (약 1~5초)
- Notion API의 페이지 children은 한 번에 100개 제한 → 긴 회의록은 자동 batch 분할

---

## 12. 라이선스

내부 사용 목적. 사용된 모델 라이선스는 각 모델 페이지를 참조하세요:
- [openai/whisper](https://github.com/openai/whisper) (MIT)
- [Qwen/Qwen2.5-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) (Apache 2.0)
- [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0) (MIT)
- [3D-Speaker eres2net](https://github.com/alibaba-damo-academy/3D-Speaker) (Apache 2.0)
