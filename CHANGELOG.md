# Changelog

All notable changes to Meeting Notes are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-05-21

First working build. End-to-end flow: mic → on-device transcription → speaker diarization → LLM-generated meeting notes → Notion DB upload.

### Added

#### Recording & audio
- 16kHz mono PCM capture via `useMicrophone` hook (ScriptProcessor-based, deferred permission prompt)
- WAV writer that patches RIFF/data sizes on close so partial files stay valid
- Disk-space guard (refuses to start if <1GB free), 2-hour soft warning, 8-hour hard auto-stop
- `before-quit` graceful shutdown that finalizes any in-flight WAV
- Audio playback via "오디오 파일 열기" (delegated to OS default player)

#### Transcription
- `smart-whisper` integration with `ggml-large-v3-turbo.bin`
- Real-time partial transcription: every 15s, transcribe the last 30s window and stream segments to the UI
- Post-recording full-resolution transcription pass

#### Diarization
- `sherpa-onnx-node` + pyannote segmentation 3.0 + 3D-Speaker eres2net embedding
- Overlap-based merger associates each transcript segment with a speaker label

#### Summarization
- `node-llama-cpp` + Qwen2.5-7B Q4_K_M
- Standard 6-section Korean meeting-notes prompt (제목 / 일시 / 참석자 / 주요 안건 / 논의 내용 / 결정 사항 / 액션 아이템)
- Auto-extracts 3~5 keyword tags via `<!-- TAGS: ... -->` sentinel

#### Notion
- Internal Integration Token storage in macOS Keychain (`keytar`)
- Database picker with auto-detected workspaces
- Markdown→Notion blocks via `@tryfabric/martian`
- Property mapping: Title (title), Date (date), Attendees (multi-select), Tags (multi-select), Uploaded (checkbox)
- 100-blocks-per-batch append for long notes

#### Models & onboarding
- First-launch overlay auto-starts all 4 model downloads in parallel
- Resumable downloads via HTTP `Range` (survives app restarts mid-download)
- Per-model installed status, aggregate progress bar
- Settings page mirrors the same download UI for later re-installs

#### UI
- Sidebar layout with route navigation, recent meetings (5 most recent)
- Library card grid with status badges
- Meeting detail view with two-pane transcript + editable notes
- Inline title editing (double-click), debounced autosave
- ⋯ menu: open audio, export `.md`, reprocess, delete
- React `ErrorBoundary` at the route layer
- macOS standard app menu (Korean labels) with edit/view/window submenus
- macOS sidebar vibrancy + OS rounded corners
- Light/dark mode via `prefers-color-scheme`
- macOS standard Cmd+Q/W/H shortcuts

#### Storage & data
- SQLite (`better-sqlite3`) with single `meetings` table (WAL mode)
- Audio files under `~/Library/Application Support/Meeting Notes/recordings/`
- Models under `~/Library/Application Support/Meeting Notes/models/`
- Settings file (`settings.json`) for non-secret preferences
- `meetings:changed` IPC broadcast keeps Library and Sidebar in sync

#### Build & deployment
- `electron-vite` bundling, Vite HMR for renderer
- TypeScript strict mode (both Node and Web configs)
- `@electron/rebuild` of native modules (`better-sqlite3`, `keytar`, `smart-whisper`)
- Universal binary (arm64 + x64) DMG via `electron-builder`
- `scripts/integration-test.mjs` — 9 pure-JS module checks (WAV round-trip, merger, prompts, downloader URL reachability, martian)

### Notes
- Notarization disabled in this build; users see the "unidentified developer" Gatekeeper prompt and must right-click → open on first launch
- 16-bit mono Whisper output: speaker-diarization accuracy hovers around 80% for single-mic captures
- All AI processing is local; only the final notes leave the device when the user clicks "Notion에 업로드"
