import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AttendeesInput from '../components/AttendeesInput'
import WaveformPulse from '../components/WaveformPulse'
import { useRecording } from '../contexts/RecordingContext'
import { getApi } from '../lib/api'
import type { Project } from '../../../shared/types'

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

type Mode = 'record' | 'upload'

const ACCEPT_ATTR =
  '.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.wma,.mp4,.mov,.avi,.mkv,.webm,.m4v,.mpg,.mpeg,audio/*,video/*'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function NewMeeting(): React.JSX.Element {
  const rec = useRecording()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('record')
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState<string>(() => toLocalDatetimeValue(new Date()))
  const [attendees, setAttendees] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [whisperReady, setWhisperReady] = useState<boolean | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  // ── Upload mode state ──────────────────────────────────────────────────
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    const api = getApi()
    if (!api) return
    void api.projects.list().then(setProjects)
  }, [])

  const addProject = async (): Promise<void> => {
    const api = getApi()
    const name = newProjectName.trim()
    if (!api || !name) return
    const p = await api.projects.create(name)
    setProjects((cur) => [...cur, p])
    setProjectId(p.id)
    setNewProjectName('')
    setCreatingProject(false)
  }

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
      await rec.start({ title: resolvedTitle, startedAt, attendees, projectId: projectId || null })
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

  const submitUpload = async (): Promise<void> => {
    if (!uploadFile || busy) return
    const api = getApi()
    if (!api) return
    setUploadError(null)
    setBusy(true)
    try {
      // Resolve the on-disk path via the preload (webUtils). Not available
      // outside Electron — the dev HTTP bridge can't ship file uploads.
      const win = window as unknown as { api?: { fs?: { getPathForFile?: (f: File) => string } } }
      const sourceFilePath = win.api?.fs?.getPathForFile?.(uploadFile)
      if (!sourceFilePath) {
        setUploadError('파일 업로드는 데스크톱 앱에서만 가능합니다.')
        return
      }
      const startedAt = scheduledAt ? new Date(scheduledAt).getTime() : Date.now()
      const resolvedTitle = title.trim() || uploadFile.name.replace(/\.[^/.]+$/, '')
      const meeting = await api.meetings.createFromFile({
        title: resolvedTitle,
        startedAt,
        attendees,
        projectId: projectId || null,
        sourceFilePath
      })
      navigate(`/meeting/${meeting.id}`)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pickFromInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0] ?? null
    if (f) setUploadFile(f)
    setUploadError(null)
    // Reset so picking the same file twice still fires onChange.
    e.target.value = ''
  }
  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropActive(true)
  }
  const onDragLeave = (): void => setDropActive(false)
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setUploadFile(f)
      setUploadError(null)
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
            <header style={{ textAlign: 'center', display: 'grid', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontSize: 22, fontWeight: 600 }}>
                {mode === 'record' ? '새 회의 녹음' : '회의 파일 업로드'}
              </h2>
              <p className="muted" style={{ fontSize: 13 }}>
                {mode === 'record'
                  ? '회의 정보를 입력하고 녹음을 시작하세요. 종료 시 자동으로 전사·요약이 실행됩니다.'
                  : 'mp3·wav·mp4 등 기존 회의 파일을 올리면 자동으로 전사와 회의록이 작성됩니다.'}
              </p>
              <div
                className="seg-toggle"
                role="tablist"
                aria-label="입력 방식"
                data-active={mode === 'record' ? '0' : '1'}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'record'}
                  className={mode === 'record' ? 'active' : ''}
                  onClick={() => setMode('record')}
                >
                  마이크 녹음
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'upload'}
                  className={mode === 'upload' ? 'active' : ''}
                  onClick={() => setMode('upload')}
                >
                  파일 업로드
                </button>
              </div>
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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <label className="label" style={{ marginBottom: 0 }}>
                    프로젝트
                  </label>
                  {!creatingProject && (
                    <button
                      type="button"
                      className="label-add"
                      onClick={() => setCreatingProject(true)}
                    >
                      + 프로젝트
                    </button>
                  )}
                </div>
                <select
                  className="select"
                  style={{ marginTop: 6 }}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value=""></option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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

              {mode === 'record' ? (
                <>
                  <div>
                    <label className="label">입력 장치</label>
                    <select
                      className="select"
                      value={rec.selectedDeviceId ?? ''}
                      onChange={(e) => rec.setSelectedDeviceId(e.target.value)}
                      disabled={rec.devices.length === 0}
                    >
                      {rec.devices.length === 0 && (
                        <option value="">마이크 권한이 필요합니다</option>
                      )}
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
                </>
              ) : (
                <div>
                  <label className="label">회의 파일</label>
                  <label
                    className={`file-drop ${dropActive ? 'is-over' : ''} ${uploadFile ? 'has-file' : ''}`}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    <input
                      type="file"
                      accept={ACCEPT_ATTR}
                      onChange={pickFromInput}
                      style={{ display: 'none' }}
                    />
                    {uploadFile ? (
                      <>
                        <div className="file-drop-name">{uploadFile.name}</div>
                        <div className="file-drop-meta">
                          {formatBytes(uploadFile.size)} · 클릭해서 다른 파일 선택
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="file-drop-title">
                          파일을 끌어다 놓거나 클릭해서 선택
                        </div>
                        <div className="file-drop-meta">
                          mp3, wav, m4a, flac · mp4, mov, avi, mkv, webm
                        </div>
                      </>
                    )}
                  </label>
                  {uploadError && (
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 12,
                        color: 'var(--danger)',
                        background: 'var(--danger-soft)',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)'
                      }}
                    >
                      {uploadError}
                    </div>
                  )}
                </div>
              )}
            </div>

            {mode === 'record' ? (
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
            ) : (
              <button
                className="btn btn-primary btn-lg"
                disabled={busy || !uploadFile}
                onClick={submitUpload}
              >
                {busy ? '변환 중…' : '회의록 만들기'}
              </button>
            )}
          </div>
        </div>

        {creatingProject && (
          <div
            className="modal-backdrop"
            onClick={() => setCreatingProject(false)}
            role="presentation"
          >
            <div
              className="modal-card"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="modal-title">새 프로젝트</h3>
              <p className="modal-desc">회의들을 묶을 프로젝트 이름을 입력하세요.</p>
              <input
                className="input"
                autoFocus
                placeholder="예: 제품팀, 2026 Q3 출시"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addProject()
                  if (e.key === 'Escape') setCreatingProject(false)
                }}
              />
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setCreatingProject(false)}>
                  취소
                </button>
                <button
                  className="btn btn-primary"
                  onClick={addProject}
                  disabled={!newProjectName.trim()}
                >
                  만들기
                </button>
              </div>
            </div>
          </div>
        )}
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
