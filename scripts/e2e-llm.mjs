/**
 * LLM summarization smoke test. Run with:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --experimental-vm-modules scripts/e2e-llm.mjs
 *
 * node-llama-cpp is ESM-only, so this runs as .mjs. First invocation
 * downloads the platform binary (~50MB, 30–90s); subsequent runs are
 * instant. Uses the already-installed Qwen2.5-7B GGUF.
 */

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const MODEL = join(
  homedir(),
  'Library/Application Support/meeting-notes/models/qwen2.5-7b-instruct-q4_k_m.gguf'
)

const transcript = [
  { start: 0, end: 3.58, speaker: 'SPK1', text: '안녕하세요. 오늘은 제품 로드맵 회의를 시작하겠습니다.' },
  { start: 3.58, end: 6.92, speaker: 'SPK1', text: '첫 번째 안건은 다음 분기 출시 일정입니다.' }
]

const prompt = `당신은 회의 전사본을 분석해 깔끔한 한국어 회의록을 작성하는 보조원입니다.

다음 전사본을 분석해서 아래 형식의 마크다운 회의록을 작성하세요. 항목이 비어 있더라도 헤더는 유지하세요.

# 제품 로드맵 회의

- **일시**: 2026-05-21 09:00 (7초)
- **참석자**: SPK1

## 주요 안건
- (회의에서 다룬 핵심 주제 3~5개를 짧은 불릿으로)

## 논의 내용
- (각 안건에 대한 논의 흐름을 항목별로 정리)

## 결정 사항
- (회의에서 합의되거나 결정된 사항)

## 액션 아이템
| 담당 | 내용 | 기한 |
|------|------|------|

<!-- TAGS: 키워드1, 키워드2, 키워드3 -->

규칙:
1. 한국어 존댓말로 작성합니다.
2. 회의에 등장하지 않은 내용을 만들어내지 마세요.
3. 마지막 줄 \`<!-- TAGS: ... -->\` 주석에 명사 3~5개를 쉼표로 구분.
4. 회의록 마크다운만 출력.

전사본:
[00:00] SPK1: 안녕하세요. 오늘은 제품 로드맵 회의를 시작하겠습니다.
[00:03] SPK1: 첫 번째 안건은 다음 분기 출시 일정입니다.
`

const t0 = Date.now()
console.log('[llm] importing node-llama-cpp (first run may auto-download binary)…')
const { getLlama, LlamaChatSession } = await import('node-llama-cpp')
console.log(`[llm] imported in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const llama = await getLlama()
const tLoad = Date.now()
console.log('[llm] loading model…')
const model = await llama.loadModel({ modelPath: MODEL })
const ctx = await model.createContext({ contextSize: 4096 })
console.log(`[llm] model loaded in ${((Date.now() - tLoad) / 1000).toFixed(1)}s`)
const session = new LlamaChatSession({
  contextSequence: ctx.getSequence(),
  systemPrompt: '당신은 한국어 회의록 작성 전문가입니다.'
})
const tGen = Date.now()
console.log('[llm] generating…')
const response = await session.prompt(prompt, { maxTokens: 1024 })
console.log(`[llm] generated in ${((Date.now() - tGen) / 1000).toFixed(1)}s`)
console.log('────────────── OUTPUT ──────────────')
console.log(response.trim())
console.log('────────────────────────────────────')
console.log(`[total] ${((Date.now() - t0) / 1000).toFixed(1)}s`)

// Verify the TAGS extraction
const re = /<!--\s*TAGS:\s*([^>]+?)\s*-->/i
const m = response.match(re)
if (m) {
  console.log('[tags]', m[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 5))
}
