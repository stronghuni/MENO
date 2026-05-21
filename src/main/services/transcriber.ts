import { existsSync } from 'fs'
import { join } from 'path'
import { Whisper } from 'smart-whisper'
import { getModelsDir } from './storage'
import { readWav } from './wavReader'
import type { TranscriptSegment } from '../../shared/types'

const MODEL_FILENAME = 'ggml-large-v3-turbo.bin'

let cached: Whisper | null = null

export function getModelPath(): string {
  return join(getModelsDir(), MODEL_FILENAME)
}

export function isModelInstalled(): boolean {
  return existsSync(getModelPath())
}

export function getMissingModelError(): Error {
  return new Error(
    `Whisper 모델 파일(${MODEL_FILENAME})이 설치되지 않았습니다. 설정 화면에서 모델을 다운로드하세요.`
  )
}

function getWhisper(): Whisper {
  if (cached) return cached
  if (!isModelInstalled()) throw getMissingModelError()
  // CAUTION: smart-whisper's `offload` is "seconds until auto-free", not
  // "do not offload". `offload: 0` means "free 0ms after each task ends",
  // which then forces a model reload on the next call. The reload path
  // hits a binding bug where `whisper_context_params` is allocated on
  // the stack without `whisper_context_default_params()` initialization,
  // so `dtw_n_top` gets garbage values and the C side crashes with
  // "aheads_masks_init failed for alignment heads masks". We patched
  // the binding to use defaults (see node_modules/.../model.cc), and we
  // additionally keep the model loaded for the entire session by using
  // a large offload window. `unloadModel()` is called explicitly on
  // app quit.
  cached = new Whisper(getModelPath(), { gpu: true, offload: 24 * 60 * 60 })
  return cached
}

export interface TranscribeProgress {
  segment: TranscriptSegment
  count: number
}

// Whisper Large-v3's training data is full of Korean broadcast & YouTube
// subtitles, which causes the model to hallucinate subtitle credits, news
// sign-offs, and YouTuber sign-offs during silence or background noise.
// These are very well-documented (see whisper-cpp issue tracker). We drop
// any segment whose entire text matches one of these patterns.
const HALLUCINATION_PATTERNS: RegExp[] = [
  /한글\s*자막\s*by\s*\S+/i,
  /자막\s*제작[:\s]/,
  /자막\s*제공[:\s]/,
  /자막\s*by\s*\S+/i,
  /구독과?\s*좋아요\s*(부탁)?/,
  /시청해?\s*주셔서\s*감사/,
  /다음\s*영상에서\s*만나요/,
  /다음\s*시간에\s*뵙겠습니다/,
  /MBC\s*뉴스\s*\S+입니다/,
  /KBS\s*뉴스\s*\S+입니다/,
  /SBS\s*뉴스\s*\S+입니다/,
  /이\s*영상은\s*.*후원/,
  /amara\.org/i,
  // English variants that occasionally pop in for mixed-language audio.
  /^thanks?\s*for\s*watching!?$/i,
  /^subtitles?\s*by\s*the\s*amara/i,
  /^please\s*subscribe/i
]

function isHallucination(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  // Plain repetition like "아 아 아 아 아 아" — common when audio is noise
  // or near-silent. Anything where 80%+ of the unique chars repeat 4+
  // times in a row falls into this bucket.
  if (/(\S)\s*(?:\1\s*){5,}/.test(t)) return true
  return HALLUCINATION_PATTERNS.some((re) => re.test(t))
}

export async function transcribeWav(
  wavPath: string,
  onProgress?: (p: TranscribeProgress) => void
): Promise<TranscriptSegment[]> {
  const { pcm, sampleRate } = await readWav(wavPath)
  if (sampleRate !== 16000) {
    throw new Error(`Expected 16kHz WAV, got ${sampleRate}Hz`)
  }
  const whisper = getWhisper()
  // Streaming segments delivered via `task.on('transcribed', ...)`. Listener
  // is attached as early as possible so we don't miss segments emitted by
  // smart-whisper's C++ scheduler. We also re-collect from `task.result`
  // which holds the final ordered list (when the binding doesn't error).
  const segments: TranscriptSegment[] = []
  const seen = new Set<string>()
  const taskPromise = whisper.transcribe(pcm, {
    language: 'ko',
    format: 'simple',
    // Match the standalone E2E test (which works reliably). On a 12-core
    // M-series 6 threads is the sweet spot — pushing to 8 occasionally
    // overlaps Metal/CPU contention and we've seen whisper_full bail.
    n_threads: 6,
    print_progress: false,
    print_realtime: false,
    // Anti-hallucination knobs:
    //   - no_speech_threshold: stricter "is this silence?" cutoff.
    //     Default 0.6; bumping to 0.8 drops more borderline-quiet chunks
    //     so the model doesn't fall back to memorized subtitle credits.
    //   - logprob_threshold: drop segments where the model is unsure.
    //   - condition_on_previous_text: false stops the repetition cascade
    //     where one hallucination primes the next.
    no_speech_threshold: 0.8,
    logprob_threshold: -0.8,
    condition_on_previous_text: false
  } as Parameters<typeof whisper.transcribe>[1])
  const task = await taskPromise
  const pushSegment = (r: { from: number; to: number; text: string }): void => {
    const text = r.text.trim()
    if (isHallucination(text)) return
    const seg: TranscriptSegment = {
      start: r.from / 1000,
      end: r.to / 1000,
      speaker: null,
      text
    }
    // Dedupe in case both the event and the fallback hand us the same row.
    const key = `${seg.start}|${seg.end}|${seg.text}`
    if (seen.has(key)) return
    seen.add(key)
    segments.push(seg)
    onProgress?.({ segment: seg, count: segments.length })
  }
  task.on('transcribed', pushSegment)
  const finalResults = await task.result
  // The C++ binding's resolve value isn't strictly typed in smart-whisper —
  // observed it returning undefined under some startup orderings. Guard
  // before iterating; the event listener has already captured what came
  // through.
  if (Array.isArray(finalResults)) {
    for (const r of finalResults) pushSegment(r)
  } else if (finalResults && typeof finalResults === 'object') {
    // Some smart-whisper builds resolve to `{ result: [...] }` instead of
    // a bare array. Handle the wrapped shape transparently.
    const wrapped = finalResults as unknown as { result?: unknown[]; results?: unknown[] }
    const arr = (wrapped.result ?? wrapped.results) as
      | { from: number; to: number; text: string }[]
      | undefined
    if (Array.isArray(arr)) {
      for (const r of arr) pushSegment(r)
    } else {
      console.warn(
        '[transcriber] task.result shape unknown, keys=',
        Object.keys(finalResults)
      )
    }
  } else {
    console.warn('[transcriber] task.result was', typeof finalResults, finalResults)
  }
  segments.sort((a, b) => a.start - b.start)
  return segments
}

// ─────────────────────────────────────────────────────────────────────
//  Chunked transcription for long audio
//
//  Why: a 1-hour meeting fed to Whisper as one 230MB Float32 buffer
//  works in principle, but everything is in-memory until the call
//  returns ~3-5 minutes later. If the process crashes mid-run we lose
//  the lot. Splitting into 5-minute chunks lets us persist after each
//  one so the user keeps everything up to the failure point, and the
//  per-chunk memory peak drops by 10×.
//
//  Why this design (fixed window + overlap, not VAD):
//   - Whisper itself processes audio in 30s windows internally, so
//     it handles short cross-chunk artifacts well without help from us.
//   - We add 10s overlap between chunks so a sentence straddling a
//     chunk boundary still has full context on the second pass.
//   - Overlap-region segments are deduped by timestamp comparison
//     against the previous chunk's tail.
//   - Skipping VAD keeps the implementation tight and avoids another
//     model dependency.
// ─────────────────────────────────────────────────────────────────────

const CHUNK_SEC = 300
const OVERLAP_SEC = 10
const CHUNK_THRESHOLD_SEC = 360 // ≤ 6 min → single-pass for simplicity

interface AudioChunk {
  startSec: number
  endSec: number
  pcm: Float32Array
}

function chunkPcm(pcm: Float32Array, sampleRate: number): AudioChunk[] {
  const totalSec = pcm.length / sampleRate
  if (totalSec <= CHUNK_THRESHOLD_SEC) {
    return [{ startSec: 0, endSec: totalSec, pcm }]
  }
  const chunks: AudioChunk[] = []
  let startSec = 0
  while (startSec < totalSec) {
    const endSec = Math.min(startSec + CHUNK_SEC, totalSec)
    const startSample = Math.floor(startSec * sampleRate)
    const endSample = Math.floor(endSec * sampleRate)
    chunks.push({
      startSec,
      endSec,
      pcm: pcm.subarray(startSample, endSample)
    })
    if (endSec >= totalSec) break
    startSec = endSec - OVERLAP_SEC
  }
  return chunks
}

export interface ChunkProgress {
  chunkIdx: number
  totalChunks: number
  chunkStartSec: number
  chunkEndSec: number
  accumulatedSegments: TranscriptSegment[]
}

/**
 * Long-audio variant. Splits the WAV into 5-minute chunks with 10s
 * overlap, transcribes each in sequence, and emits a callback after
 * every chunk so the caller can persist progress. Segments are emitted
 * with timestamps offset into the full recording timeline.
 *
 * For audio under {@link CHUNK_THRESHOLD_SEC} this collapses to a
 * single call so short meetings don't pay the chunking overhead.
 */
export async function transcribeWavChunked(
  wavPath: string,
  onSegment?: (seg: TranscriptSegment, count: number) => void,
  onChunkComplete?: (p: ChunkProgress) => void
): Promise<TranscriptSegment[]> {
  const { pcm, sampleRate } = await readWav(wavPath)
  if (sampleRate !== 16000) {
    throw new Error(`Expected 16kHz WAV, got ${sampleRate}Hz`)
  }
  const chunks = chunkPcm(pcm, sampleRate)
  const whisper = getWhisper()
  const accumulated: TranscriptSegment[] = []
  // Anchor used to dedupe overlap-region segments. Anything starting
  // before this watermark in the next chunk has already been emitted.
  let lastCommittedEnd = 0

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i]
    const taskPromise = whisper.transcribe(ch.pcm, {
      language: 'ko',
      format: 'simple',
      n_threads: 6,
      print_progress: false,
      print_realtime: false,
      no_speech_threshold: 0.8,
      logprob_threshold: -0.8,
      condition_on_previous_text: false
    } as Parameters<typeof whisper.transcribe>[1])
    const task = await taskPromise

    const seenInChunk = new Set<string>()
    const acceptSegment = (r: { from: number; to: number; text: string }): void => {
      const text = r.text.trim()
      if (isHallucination(text)) return
      const absStart = ch.startSec + r.from / 1000
      const absEnd = ch.startSec + r.to / 1000
      // Drop anything still inside the overlap region the previous
      // chunk already committed. 0.5s tolerance accommodates Whisper's
      // tendency to nudge boundaries by a few hundred ms between runs.
      if (absStart < lastCommittedEnd - 0.5) return
      const key = `${absStart.toFixed(2)}|${absEnd.toFixed(2)}|${text}`
      if (seenInChunk.has(key)) return
      seenInChunk.add(key)
      const seg: TranscriptSegment = {
        start: absStart,
        end: absEnd,
        speaker: null,
        text
      }
      accumulated.push(seg)
      onSegment?.(seg, accumulated.length)
    }

    task.on('transcribed', acceptSegment)
    const finalResults = await task.result
    if (Array.isArray(finalResults)) {
      for (const r of finalResults) acceptSegment(r)
    } else if (finalResults && typeof finalResults === 'object') {
      const wrapped = finalResults as unknown as { result?: unknown[]; results?: unknown[] }
      const arr = (wrapped.result ?? wrapped.results) as
        | { from: number; to: number; text: string }[]
        | undefined
      if (Array.isArray(arr)) for (const r of arr) acceptSegment(r)
    }

    accumulated.sort((a, b) => a.start - b.start)
    if (accumulated.length > 0) {
      lastCommittedEnd = accumulated[accumulated.length - 1].end
    }
    onChunkComplete?.({
      chunkIdx: i + 1,
      totalChunks: chunks.length,
      chunkStartSec: ch.startSec,
      chunkEndSec: ch.endSec,
      accumulatedSegments: accumulated.slice()
    })
  }

  return accumulated
}

export async function unloadModel(): Promise<void> {
  if (cached) {
    await cached.free()
    cached = null
  }
}
