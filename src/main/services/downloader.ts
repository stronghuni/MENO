import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
// statSync is used both for partial-resume offsets and the
// "already-downloaded" short-circuit below.
import { join, dirname } from 'path'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import { getModelsDir } from './storage'
import { broadcast as send } from './broadcaster'
import type { DownloadProgress, ModelSpec } from '../../shared/types'
export type { ModelSpec } from '../../shared/types'

export const MODEL_SPECS: ModelSpec[] = [
  {
    key: 'whisper',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    filename: 'ggml-large-v3-turbo.bin',
    approxBytes: 1_624_555_275
  },
  {
    key: 'llm',
    // Qwen's own repo split the 7B Q4_K_M into two shards (00001-of-00002).
    // bartowski's community single-file quant is identical content, easier
    // to load via node-llama-cpp without merging shards.
    url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    approxBytes: 4_683_074_240
  },
  {
    key: 'diarization-segmentation',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx',
    filename: 'sherpa-onnx-pyannote-segmentation-3-0.onnx',
    approxBytes: 5_926_456
  },
  {
    key: 'diarization-embedding',
    url: 'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    filename: '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    approxBytes: 39_593_761
  }
]

const active = new Map<ModelSpec['key'], AbortController>()

function broadcast(progress: DownloadProgress): void {
  send('download:progress', progress)
}

export async function downloadModel(key: ModelSpec['key']): Promise<void> {
  const spec = MODEL_SPECS.find((s) => s.key === key)
  if (!spec) throw new Error(`Unknown model: ${key}`)
  // Idempotent: a redundant call (React StrictMode double-mount, settings
  // page racing the onboarding overlay, etc.) should be a no-op rather
  // than throw. The active download keeps streaming and broadcasting its
  // own progress.
  if (active.has(key)) return

  const target = join(getModelsDir(), spec.filename)
  // If the target already exists at the expected size, treat it as done
  // immediately. This guards against re-downloading after a manual file
  // placement or a previous completed run.
  if (existsSync(target)) {
    try {
      const sz = statSync(target).size
      if (sz >= spec.approxBytes * 0.95) {
        broadcast({ key, bytesReceived: sz, totalBytes: sz, done: true })
        return
      }
    } catch {
      // fall through to normal download path
    }
  }
  mkdirSync(dirname(target), { recursive: true })

  // Allow resume by checking existing partial file.
  const tmp = `${target}.partial`
  const startByte = existsSync(tmp) ? statSync(tmp).size : 0

  const controller = new AbortController()
  active.set(key, controller)

  try {
    const headers: Record<string, string> = {}
    if (startByte > 0) headers.Range = `bytes=${startByte}-`

    const res = await fetch(spec.url, { signal: controller.signal, headers })
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    if (!res.body) throw new Error('응답 본문이 없습니다')

    const totalHeader = res.headers.get('content-length')
    const totalBytes = totalHeader
      ? Number(totalHeader) + startByte
      : spec.approxBytes

    const out = createWriteStream(tmp, { flags: startByte > 0 ? 'a' : 'w' })
    let received = startByte
    let lastBroadcast = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(res.body as any)
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      const now = Date.now()
      if (now - lastBroadcast > 200) {
        broadcast({ key, bytesReceived: received, totalBytes, done: false })
        lastBroadcast = now
      }
    })
    nodeStream.pipe(out)
    await finished(out)

    // Move tmp → final
    if (existsSync(target)) unlinkSync(target)
    const { rename } = await import('fs/promises')
    await rename(tmp, target)

    broadcast({ key, bytesReceived: received, totalBytes, done: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    broadcast({ key, bytesReceived: 0, totalBytes: spec.approxBytes, done: true, error: message })
    throw e
  } finally {
    active.delete(key)
  }
}

export function cancelDownload(key: ModelSpec['key']): boolean {
  const c = active.get(key)
  if (!c) return false
  c.abort()
  active.delete(key)
  return true
}
