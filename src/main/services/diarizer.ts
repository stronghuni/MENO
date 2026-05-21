import { existsSync } from 'fs'
import { join } from 'path'
import { getModelsDir } from './storage'
import { readWav } from './wavReader'
import type { DiarizationSegment } from '../domain/merger'

const SEG_MODEL = 'sherpa-onnx-pyannote-segmentation-3-0.onnx'
const EMB_MODEL = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'

export interface DiarizationStatus {
  segmentation: boolean
  embedding: boolean
  ready: boolean
}

export function getDiarizationStatus(): DiarizationStatus {
  const segmentation = existsSync(join(getModelsDir(), SEG_MODEL))
  const embedding = existsSync(join(getModelsDir(), EMB_MODEL))
  return { segmentation, embedding, ready: segmentation && embedding }
}

export function isDiarizationInstalled(): boolean {
  return getDiarizationStatus().ready
}

/**
 * Lazy-imported because sherpa-onnx loads its native addon eagerly on import,
 * which we want to defer until the user has downloaded the diarization models.
 *
 * sherpa-onnx-node ships as CommonJS (`module.exports = { OfflineSpeaker... }`).
 * When Rollup bundles our main process and we use `await import(...)`, the
 * shape is bundler-dependent: sometimes the named exports sit on the top
 * level, sometimes under `.default`. Earlier this returned the wrapped
 * namespace object with no `OfflineSpeakerDiarization` and we silently
 * fell into processor.ts's catch block, dropping every speaker label.
 * Normalize both shapes here.
 */
async function loadSherpa(): Promise<typeof import('sherpa-onnx-node')> {
  const mod = await import('sherpa-onnx-node')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  if (m.OfflineSpeakerDiarization) return m
  if (m.default?.OfflineSpeakerDiarization) return m.default
  throw new Error('sherpa-onnx-node module shape unrecognized')
}

export async function diarizeWav(wavPath: string): Promise<DiarizationSegment[]> {
  if (!isDiarizationInstalled()) {
    throw new Error('화자 분리 모델이 설치되지 않았습니다. 설정 화면에서 다운로드하세요.')
  }
  const sherpa = await loadSherpa()
  const config = {
    segmentation: {
      pyannote: {
        model: join(getModelsDir(), SEG_MODEL)
      },
      debug: false
    },
    embedding: {
      model: join(getModelsDir(), EMB_MODEL),
      debug: false
    },
    clustering: {
      // -1 = auto-detect number of speakers via clustering threshold
      numClusters: -1,
      threshold: 0.5
    },
    minDurationOn: 0.3,
    minDurationOff: 0.5
  }
  const diar = new sherpa.OfflineSpeakerDiarization(config)
  const { pcm, sampleRate } = await readWav(wavPath)
  if (sampleRate !== diar.sampleRate) {
    throw new Error(
      `Diarization model expects ${diar.sampleRate}Hz, got ${sampleRate}Hz. Resampling not implemented.`
    )
  }
  const raw = diar.process(pcm) as { start: number; end: number; speaker: number }[]
  return raw.map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }))
}
