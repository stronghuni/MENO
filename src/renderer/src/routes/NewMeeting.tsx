import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AttendeesInput from '../components/AttendeesInput'
import WaveformPulse from '../components/WaveformPulse'
import { useRecording } from '../contexts/RecordingContext'
import { getApi } from '../lib/api'

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Build a value safe for <input type="datetime-local"> (local time, no TZ). */
function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultTitle(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `회의 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NewMeeting(): React.JSX.Element {
  const rec = useRecording()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState<string>(() => toLocalDatetimeValue(new Date()))
  const [attendees, setAttendees] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [whisperReady, setWhisperReady] = useState<boolean | null>(null)

  useEffect(() => {
    const api = getApi()
    if (!api) {
      setWhisperReady(false)
      return
    }
    const check = (): void => {
      void api.models.whisperInstalled().then(setWhisperReady)
    }
    check()
    return api.downloads.onProgress((p) => {
      if (p.key === 'whisper' && p.done && !p.error) check()
    })
  }, [])

  const startRecording = async (): Promise<void> => {
    if (busy || rec.isRecording) return
    setBusy(true)
    try {
      const startedAt = scheduledAt ? new Date(scheduledAt).getTime() : Date.now()
      const resolvedTitle = title.trim() || defaultTitle(new Date(startedAt))
      await rec.start({ title: resolvedTitle, startedAt, attendees })
    } finally {
      setBusy(false)
    }
  }

  const stopRecording = async (): Promise<void> => {
    if (busy || !rec.isRecording) return
    setBusy(true)
    try {
      const result = await rec.stop()
      if (result) navigate(`/meeting/${result.meetingId}`)
    } finally {
      setBusy(false)
    }
  }

  const togglePause = async (): Promise<void> => {
    if (!rec.isRecording) return
    if (rec.isPaused) await rec.resume()
    else await rec.pause()
  }

  if (!rec.isRecording) {
    return (
      <div className="main">
        <header className="main-header">
          <h1>새 회의</h1>
        </header>
        <div
          className="main-content"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ width: '100%', maxWidth: 480, margin: 'auto', display: 'grid', gap: 18 }}>
            <header style={{ textAlign: 'center', display: 'grid', gap: 6, marginBottom: 4 }}>
              <h2 style={{ fontSize: 22, fontWeight: 600 }}>새 회의 녹음</h2>
              <p className="muted" style={{ fontSize: 13 }}>
                회의 정보를 입력하고 녹음을 시작하세요. 종료 시 자동으로 전사·요약이 실행됩니다.
              </p>
            </header>

            {whisperReady === false && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 'var(--radius)',
                  background: 'var(--warn-banner-bg)',
                  color: 'var(--warn-banner-text)',
                  fontSize: 12,
                  border: '1px solid var(--warn-banner-border)'
                }}
              >
                <span>
                  Whisper 모델이 설치되지 않았습니다. 지금 녹음해도 전사가 되지 않으니 먼저 다운로드하세요.
                </span>
                <Link to="/settings" className="btn" style={{ flexShrink: 0 }}>
                  설정 열기
                </Link>
              </div>
            )}

            <div className="card" style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="label">제목</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={defaultTitle(new Date(scheduledAt || Date.now()))}
                />
              </div>

              <div>
                <label className="label">날짜 · 시작 시간</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>

              <div>
                <label className="label">참여자</label>
                <AttendeesInput
                  value={attendees}
                  onChange={setAttendees}
                  placeholder="이름 입력 후 콤마(,) — 김민수, 이서연, 박지훈"
                />
              </div>

              <div>
                <label className="label">입력 장치</label>
                <select
                  className="select"
                  value={rec.selectedDeviceId ?? ''}
                  onChange={(e) => rec.setSelectedDeviceId(e.target.value)}
                  disabled={rec.devices.length === 0}
                >
                  {rec.devices.length === 0 && <option value="">마이크 권한이 필요합니다</option>}
                  {rec.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              {rec.micError && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--danger)',
                    background: 'var(--danger-soft)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)'
                  }}
                >
                  {rec.micError}
                </div>
              )}
            </div>

            <button
              className="btn btn-primary btn-lg"
              disabled={busy || rec.devices.length === 0}
              onClick={startRecording}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'var(--danger)',
                  boxShadow: '0 0 0 3px rgba(220,38,38,0.3)'
                }}
              />
              녹음 시작
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────── Recording view (full-bleed visualizer + bottom dock) ───
  return (
    <div className="main recording-main">
      <header className="main-header recording-header">
        <h1>{rec.meetingTitle ?? '녹음 중'}</h1>
      </header>

      {rec.watchdog && (
        <div
          style={{
            margin: '12px var(--space-6) 0',
            padding: '10px 14px',
            borderRadius: 'var(--radius)',
            background: 'var(--warn-banner-bg)',
            border: '1px solid var(--warn-banner-border)',
            color: 'var(--warn-banner-text)',
            fontSize: 12
          }}
        >
          {rec.watchdog}
        </div>
      )}

      <div className="recording-stage">
        <WaveformPulse
          level={rec.level}
          analyserRef={rec.analyserRef}
          paused={rec.isPaused}
        />
      </div>

      {/* Bottom dock — voice-recorder controls: status / elapsed / pause / end */}
      <div className="recorder-dock">
        <div className="recorder-dock-status">
          <span className={`recorder-rec-dot ${rec.isPaused ? 'paused' : ''}`} aria-hidden />
          <span className="recorder-rec-label">{rec.isPaused ? '일시정지' : 'REC'}</span>
        </div>

        <div className="recorder-dock-time" aria-label="elapsed">
          {formatDuration(rec.elapsedMs)}
        </div>

        <div className="recorder-dock-controls">
          <button
            type="button"
            className={`recorder-pause ${rec.isPaused ? 'is-paused' : ''}`}
            onClick={togglePause}
            disabled={busy}
            aria-label={rec.isPaused ? '재개' : '일시정지'}
            title={rec.isPaused ? '재개' : '일시정지'}
          >
            {rec.isPaused ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="recorder-stop"
            onClick={stopRecording}
            disabled={busy}
            aria-label="회의 종료"
            title="회의 종료"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
            <span>회의 종료</span>
          </button>
        </div>
      </div>
    </div>
  )
}
