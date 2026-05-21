# CLAUDE.md — MENO

macOS Electron desktop app: meeting recorder → Whisper STT → Qwen 2.5 meeting
notes → optional Notion upload + per-library chat assistant. Speaker diarization
was removed (onnxruntime 1.24 KleidiAI Conv SIGTRAP on Apple Silicon).

## Quick Start

```bash
npm install              # also rebuilds native deps for Electron ABI via postinstall
npm run dev              # Electron + Vite HMR + dev HTTP bridge on :9877
npm run typecheck        # both tsconfig.node + tsconfig.web
npm test                 # vitest (pure-JS unit tests)
npm run build:mac        # signed-ready DMG for arm64 + x64
```

If install fails on native modules: `npm install --ignore-scripts && npx @electron/rebuild -f -w better-sqlite3 -w smart-whisper -w keytar`.

## Architecture (2-process Electron, all-Node)

- `src/main/` — Node main process. SQLite, mic-WAV recorder, Whisper/Qwen workers.
- `src/preload/index.ts` — exposes `window.api` via contextBridge.
- `src/renderer/src/` — React 19 + HashRouter; `RecordingProvider` at App level keeps mic alive across route changes.
- `src/shared/types.ts` — shared types for IPC payloads.

IPC channel registry: `src/main/handlers.ts` (single map shared by `ipcMain.handle` and the dev HTTP bridge).

## Dev HTTP Bridge (critical for E2E + browser testing)

In dev mode `src/main/devBridge.ts` starts an HTTP+SSE server on `127.0.0.1:9877`:
- `POST /api/<channel>` with `{"args": [...]}` → calls the same handler as IPC
- `POST /api/<channel>?meetingId=...` with raw `application/octet-stream` body → for `recording:chunk`
- `GET /events` → SSE stream of every `broadcast(...)` event
- `GET /healthz` → `{ ok, handlers }` smoke check

The renderer at `http://localhost:5173` automatically uses the bridge when `window.api` is unavailable (see `src/renderer/src/lib/api.ts`). This is the path for Python E2E scripts.

## Data Locations (userData)

`~/Library/Application Support/meno/`
- `meno.db` (SQLite, WAL mode) — meetings table only
- `models/` — Whisper + Qwen (~6.3 GB total)
- `recordings/<uuid>.wav` — raw 16 kHz mono PCM
- `chat.json` — global chat history
- `settings.json` — theme, notionParentId, autoUploadToNotion, onboardingCompleted
- Keychain SERVICE: `io.namuneulbo.meno` (Notion token under account `notion.token`)

`main/index.ts` migrates the old `meeting-notes/` dir + `meno.db` + Keychain entries on first launch. Don't remove this migration before users have upgraded.

## Critical Gotchas

- **smart-whisper binding is patched**: `node_modules/smart-whisper/src/binding/model.cc` line ~102 must use `whisper_context_default_params()` to initialize. Without it, `dtw_n_top` reads stack garbage → "aheads_masks_init failed" crash on the 2nd model load. Re-run `npx @electron/rebuild -f -w smart-whisper` if you reinstall.
- **smart-whisper `offload: 0` = "free in 0 ms"**, not "never free". Use `24*60*60` so the model survives a full session. See comment in `transcriber.ts`.
- **`node-llama-cpp` model is shared** between summarizer and chat via `summarizer.getModel()`. Don't `loadModel` separately — duplicates ~5 GB.
- **Korean IME + chip input race**: detect commas in `onChange(e.target.value)`, never on `keydown` (see `AttendeesInput.tsx`).
- **Settings.tsx no longer ships model UI** — onboarding overlay handles downloads. Don't reintroduce the download row.
- **`dispose` of LlamaChatSession context**: chat.ts calls `context.dispose()` when switching meeting scope to release KV cache. Forgetting this leaks ~200 MB per scope change.
- **Recording survives route changes**: mic lives in `RecordingProvider` at App level, NOT in the route component. Don't move it back.

## Conventions

- IPC handlers: registered in `src/main/handlers.ts` as a flat record. Add new channel → also expose in `src/preload/index.ts` and `src/renderer/src/lib/api.ts` (HTTP shim).
- Renderer never imports from `src/main/`. Use `getApi()` from `lib/api.ts`.
- Tests: `vitest` for pure-JS modules under `src/main/domain/`. No DOM tests yet.
- Theme: explicit `html.theme-light` / `html.theme-dark` classes (overrides OS preference). Tokens in `tokens.css`.
- Form controls: explicitly set `color` + `background-color` to theme tokens — otherwise they pick up OS prefers-color-scheme and look broken when user toggles.

## Refusal Persona (chat)

When the chat LLM produces an off-topic refusal, `chat.ts → normalizeRefusal()` snaps it to the canonical phrase:

> 회의록과 관련된 질문에만 답해드릴 수 있습니다.

Don't change the canonical string without also updating `REFUSAL_PATTERN`.

## Don't

- Don't push directly to `main` on origin — auto-mode blocks it. Use a feature branch + PR (or ask user to push).
- Don't change Keychain SERVICE or userData directory name without adding to the migration in `main/index.ts` + `services/keychain.ts`.
- Don't add live transcription during recording — by product decision, transcription happens only on stop (one Whisper call total).
- Don't introduce a fixed `maxWidth` on full-page routes; users want responsive (Settings already learned this lesson at 680 → 1100).
