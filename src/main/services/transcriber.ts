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
    print_realtime: false
  })
  const task = await taskPromise
  const pushSegment = (r: { from: number; to: number; text: string }): void => {
    const seg: TranscriptSegment = {
      start: r.from / 1000,
      end: r.to / 1000,
      speaker: null,
      text: r.text.trim()
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

export async function unloadModel(): Promise<void> {
  if (cached) {
    await cached.free()
    cached = null
  }
}
