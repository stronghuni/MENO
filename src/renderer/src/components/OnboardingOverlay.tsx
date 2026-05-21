import { useEffect, useState } from 'react'
import { getApi } from '../lib/api'
import type { DownloadProgress, ModelSpec } from '../../../shared/types'

const MODEL_LABELS: Record<ModelSpec['key'], string> = {
  whisper: 'Whisper Large-v3 Turbo (전사)',
  llm: 'Qwen2.5-7B Q4_K_M (요약)',
  'diarization-segmentation': 'Pyannote Segmentation (화자 분리)',
  'diarization-embedding': '3D-Speaker Embedding (화자 분리)'
}

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

interface ModelStatus {
  whisper: boolean
  diarization: { segmentation: boolean; embedding: boolean; ready: boolean }
  llm: boolean
}

function isModelInstalled(status: ModelStatus, key: ModelSpec['key']): boolean {
  if (key === 'whisper') return status.whisper
  if (key === 'llm') return status.llm
  if (key === 'diarization-segmentation') return status.diarization.segmentation
  if (key === 'diarization-embedding') return status.diarization.embedding
  return false
}

export default function OnboardingOverlay({
  onClose
}: {
  onClose: () => void
}): React.JSX.Element {
  const [specs, setSpecs] = useState<ModelSpec[]>([])
  const [progress, setProgress] = useState<Record<string, DownloadProgress | null>>({})
  const [models, setModels] = useState<ModelStatus | null>(null)
  const [autoStarted, setAutoStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    const [s, w, d, l] = await Promise.all([
      api.downloads.specs(),
      api.models.whisperInstalled(),
      api.models.diarizationStatus(),
      api.models.llmInstalled()
    ])
    setSpecs(s)
    setModels({ whisper: w, diarization: d, llm: l })
  }

  useEffect(() => {
    void refresh()
    const api = getApi()
    if (!api) return
    return api.downloads.onProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.key]: p }))
      if (p.done && !p.error) void refresh()
    })
  }, [])

  useEffect(() => {
    // Auto-start any model that isn't installed and isn't already downloading.
    if (autoStarted || !models || specs.length === 0) return
    setAutoStarted(true)
    const api = getApi()
    if (!api) return
    void (async (): Promise<void> => {
      try {
        for (const spec of specs) {
          if (isModelInstalled(models, spec.key)) continue
          if (progress[spec.key] && !progress[spec.key]?.done) continue
          // Kick off downloads in parallel by not awaiting.
          api.downloads.start(spec.key).catch((e) => {
            setError(e instanceof Error ? e.message : String(e))
          })
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, specs])

  const allDone =
    models && specs.length > 0 && specs.every((s) => isModelInstalled(models, s.key))
  const totalBytes = specs.reduce((sum, s) => sum + s.approxBytes, 0)
  const receivedBytes = specs.reduce((sum, s) => {
    if (models && isModelInstalled(models, s.key)) return sum + s.approxBytes
    const p = progress[s.key]
    return sum + (p ? p.bytesReceived : 0)
  }, 0)
  const overallPct = totalBytes > 0 ? Math.min(100, (receivedBytes / totalBytes) * 100) : 0

  const dismiss = async (markComplete: boolean): Promise<void> => {
    const api = getApi()
    if (api && markComplete) {
      await api.settings.save({ onboardingCompleted: true })
    }
    onClose()
  }

  useEffect(() => {
    if (allDone) {
      void dismiss(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.36)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fade-up 0.32s var(--ease-out)'
      }}
    >
      <div
        style={{
          width: 'min(520px, 90vw)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 24,
          display: 'grid',
          gap: 18
        }}
      >
        <header style={{ display: 'grid', gap: 6 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>
            {allDone ? '준비가 끝났습니다' : '필요한 모델을 다운로드하고 있어요'}
          </h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
            {allDone
              ? '이제 첫 회의를 녹음할 수 있습니다.'
              : `한국어 전사·요약을 로컬에서 처리하기 위한 4개 모델입니다. 총 약 ${formatBytes(totalBytes)}, 한 번만 받으면 됩니다.`}
          </p>
        </header>

        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              marginBottom: 6,
              color: 'var(--text-muted)'
            }}
          >
            <span>
              {formatBytes(receivedBytes)} / {formatBytes(totalBytes)}
            </span>
            <span>{overallPct.toFixed(1)}%</span>
          </div>
          <div
            style={{
              height: 8,
              background: 'var(--bg-sunk)',
              borderRadius: 4,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${overallPct}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 240ms ease'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {specs.map((spec) => {
            const p = progress[spec.key]
            const done = models ? isModelInstalled(models, spec.key) : false
            const pct = done ? 100 : p ? Math.min(100, (p.bytesReceived / p.totalBytes) * 100) : 0
            const isActive = !done && p && !p.done
            const hasError = p?.error
            return (
              <div
                key={spec.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 12
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{MODEL_LABELS[spec.key]}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: done
                      ? 'var(--success)'
                      : hasError
                        ? 'var(--danger)'
                        : isActive
                          ? 'var(--accent)'
                          : 'var(--text-faint)',
                    flexShrink: 0
                  }}
                >
                  {done ? '✓ 완료' : hasError ? '✗ 실패' : isActive ? `${pct.toFixed(0)}%` : '대기'}
                </span>
              </div>
            )
          })}
        </div>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              fontSize: 12,
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <a
            href="#"
            style={{ fontSize: 12, color: 'var(--text-muted)' }}
            onClick={(e) => {
              e.preventDefault()
              void dismiss(false)
            }}
          >
            나중에 설정에서 받기
          </a>
          <button
            className="btn btn-primary"
            onClick={() => void dismiss(!!allDone)}
            disabled={!allDone && receivedBytes === 0}
          >
            {allDone ? '시작하기' : '백그라운드로 진행'}
          </button>
        </div>
      </div>
    </div>
  )
}
