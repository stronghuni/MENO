import { existsSync } from 'fs'
import { join } from 'path'
import { getModelsDir } from './storage'
import {
  buildChunkSummaryPrompt,
  buildMeetingNotesPrompt,
  buildMergePrompt,
  chunkSegmentsByTime,
  enforceAttendeesLine
} from '../domain/prompts'
import type { TranscriptSegment } from '../../shared/types'

const LLM_FILENAME = 'qwen2.5-7b-instruct-q4_k_m.gguf'

// Heuristic: a Korean character is ~1.2 tokens in Qwen2.5's tokenizer.
// We keep single-pass when the transcript text (after formatting) is under
// roughly 18 000 characters → ~22 000 tokens, leaving room for the prompt
// scaffolding and the model's output within the 32 768-token training
// context. Anything bigger goes through map-reduce.
const SINGLE_PASS_CHAR_LIMIT = 18_000
const CHUNK_SEC = 10 * 60
const OVERLAP_SEC = 60

interface LlamaSessionLike {
  prompt(input: string, opts?: { maxTokens?: number }): Promise<string>
}

let cachedSession: LlamaSessionLike | null = null

// Lazy singletons shared with chat.ts so we don't reload the 4.7GB model
// for every feature. Both summarization and chat use the same model and
// just create their own contexts.
let cachedLlama: unknown | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any | null = null

export function getLlmPath(): string {
  return join(getModelsDir(), LLM_FILENAME)
}

export function isLlmInstalled(): boolean {
  return existsSync(getLlmPath())
}

export async function getLlama(): Promise<unknown> {
  if (cachedLlama) return cachedLlama
  const { getLlama: load } = await import('node-llama-cpp')
  cachedLlama = await load()
  return cachedLlama
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getModel(): Promise<any> {
  if (cachedModel) return cachedModel
  if (!isLlmInstalled()) {
    throw new Error(`요약 모델(${LLM_FILENAME})이 설치되지 않았습니다.`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llama = (await getLlama()) as any
  cachedModel = await llama.loadModel({ modelPath: getLlmPath() })
  return cachedModel
}

async function loadSession(): Promise<LlamaSessionLike> {
  if (cachedSession) return cachedSession
  const { LlamaChatSession } = await import('node-llama-cpp')
  const model = await getModel()
  const context = await model.createContext({ contextSize: 8192 })
  cachedSession = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt:
      '당신은 한국어 회의록 작성 전문가입니다. 사용자의 지시를 정확히 따라 마크다운 회의록을 작성합니다.'
  }) as LlamaSessionLike
  return cachedSession
}

function estimateChars(segments: TranscriptSegment[]): number {
  // Match what formatTranscript emits: "[mm:ss] speaker: text" per line.
  let total = 0
  for (const s of segments) total += s.text.length + 24
  return total
}

export interface SummaryProgress {
  stage: 'chunk' | 'merge'
  current: number
  total: number
}

export async function summarize(
  title: string,
  startedAt: number,
  durationMs: number | null,
  segments: TranscriptSegment[],
  attendees: string[] = [],
  onProgress?: (p: SummaryProgress) => void
): Promise<string> {
  const session = await loadSession()
  const totalChars = estimateChars(segments)
  if (totalChars <= SINGLE_PASS_CHAR_LIMIT) {
    const prompt = buildMeetingNotesPrompt(title, startedAt, durationMs, segments, attendees)
    const response = await session.prompt(prompt, { maxTokens: 2048 })
    return enforceAttendeesLine(response.trim(), attendees)
  }
  const merged = await mapReduce(title, startedAt, durationMs, segments, attendees, session, onProgress)
  return enforceAttendeesLine(merged, attendees)
}

async function mapReduce(
  title: string,
  startedAt: number,
  durationMs: number | null,
  segments: TranscriptSegment[],
  attendees: string[],
  session: LlamaSessionLike,
  onProgress?: (p: SummaryProgress) => void
): Promise<string> {
  const chunks = chunkSegmentsByTime(segments, CHUNK_SEC, OVERLAP_SEC)
  const partials: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ stage: 'chunk', current: i + 1, total: chunks.length })
    const chunk = chunks[i]
    const prompt = buildChunkSummaryPrompt(
      chunk.segments,
      i,
      chunks.length,
      chunk.startSec,
      chunk.endSec
    )
    const out = await session.prompt(prompt, { maxTokens: 1024 })
    partials.push(out.trim())
  }
  onProgress?.({ stage: 'merge', current: chunks.length, total: chunks.length })
  // Attendees come from the user's new-meeting form, not from the
  // transcript (no diarization). Pass them through verbatim.
  const mergePrompt = buildMergePrompt(title, startedAt, durationMs, attendees, partials)
  const final = await session.prompt(mergePrompt, { maxTokens: 2048 })
  return final.trim()
}
