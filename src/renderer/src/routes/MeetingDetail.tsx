import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate, useParams } from 'react-router-dom'
import type { Meeting, ProcessingStatus, TranscriptSegment } from '../../../shared/types'
import { getApi } from '../lib/api'
import AudioPlayer from '../components/AudioPlayer'

function parseTranscript(json: string | null): TranscriptSegment[] {
  if (!json) return []
  try {
    return JSON.parse(json) as TranscriptSegment[]
  } catch {
    return []
  }
}

function formatTime(s: number): string {
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0')
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, '0')
  return `${mm}:${ss}`
}

export default function MeetingDetail(): React.JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [status, setStatus] = useState<ProcessingStatus | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const notesDirty = useRef(false)

  useEffect(() => {
    if (!id) return
    const api = getApi()
    if (!api) return
    void api.meetings.get(id).then((m) => {
      setMeeting(m)
      if (m) {
        setTitleDraft(m.title)
        if (!notesDirty.current) setNotesDraft(m.notesMd ?? '')
      }
    })
    void api.processing.status(id).then(setStatus)
  }, [id])

  useEffect(() => {
    const api = getApi()
    if (!api) return
    const unsubscribe = api.processing.onUpdate((s) => {
      if (s.meetingId !== id) return
      const previousStage = status?.stage
      setStatus(s)
      // Refresh the meeting whenever the pipeline crosses a boundary that
      // writes new data to the DB. After 'diarizing' completes the
      // transcript has just been saved, after 'summarizing' the notes are
      // saved, and after 'done' everything is final. Without this the
      // transcript pane would stay empty until the very end of the run.
      const reloadStages: ProcessingStatus['stage'][] = [
        'summarizing',
        'uploading',
        'done'
      ]
      if (s.stage !== previousStage && reloadStages.includes(s.stage)) {
        void api.meetings.get(id!).then((m) => {
          setMeeting(m)
          if (m && !notesDirty.current) setNotesDraft(m.notesMd ?? '')
        })
      }
    })
    return unsubscribe
  }, [id, status?.stage])

  const persisted = parseTranscript(meeting?.transcriptJson ?? null)
  const live = status?.partialSegments ?? []
  // Prefer the persisted transcript whenever it's available — once the
  // pipeline writes to DB it's the source of truth. During the initial
  // 'transcribing' stage we surface the live partial segments so the
  // user sees progress.
  const segments =
    persisted.length > 0
      ? persisted
      : status?.stage === 'transcribing' && live.length > 0
        ? live
        : []
  const notesSummarizing =
    !!status &&
    (status.stage === 'summarizing' ||
      (status.stage === 'uploading' && !meeting?.notesMd))

  const runAction = async (fn: () => Promise<void>): Promise<void> => {
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  const upload = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      setUploading(true)
      try {
        const { url } = await api.notion.upload(id)
        const updated = await api.meetings.get(id)
        setMeeting(updated)
        window.open(url, '_blank')
      } finally {
        setUploading(false)
      }
    })

  const saveTitle = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      const next = titleDraft.trim()
      if (!next) {
        setTitleDraft(meeting?.title ?? '')
        setEditingTitle(false)
        return
      }
      const updated = await api.meetings.update(id, { title: next })
      setMeeting(updated)
      setEditingTitle(false)
    })

  const saveNotes = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      const updated = await api.meetings.update(id, { notesMd: notesDraft })
      setMeeting(updated)
      notesDirty.current = false
    })

  const reprocess = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      await api.processing.reprocess(id)
    })

  const deleteMeeting = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      if (!confirm('이 회의를 삭제할까요? 오디오 파일도 함께 삭제됩니다.')) return
      await api.meetings.delete(id)
      navigate('/library')
    })

  const openAudio = (): Promise<void> =>
    runAction(async () => {
      if (!meeting?.audioPath) return
      const api = getApi()
      if (!api) return
      await api.shell.openPath(meeting.audioPath)
    })

  const exportNotes = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      await api.shell.exportNotes(id)
    })

  const processing = !!(
    status &&
    status.stage !== 'idle' &&
    status.stage !== 'done' &&
    status.stage !== 'error'
  )

  return (
    <div className="main">
      <header className="main-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/library')}
            aria-label="라이브러리로"
            title="라이브러리로 돌아가기"
            style={{ width: 28, height: 28, padding: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M10 3L5 8l5 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {editingTitle ? (
            <input
              className="input"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle()
                if (e.key === 'Escape') {
                  setTitleDraft(meeting?.title ?? '')
                  setEditingTitle(false)
                }
              }}
              style={{ maxWidth: 360 }}
            />
          ) : (
            <h1
              onDoubleClick={() => setEditingTitle(true)}
              title="더블클릭으로 제목 편집"
              style={{ cursor: 'text', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {meeting?.title ?? '회의 상세'}
            </h1>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {meeting?.notionPageUrl && (
            <a
              href={meeting.notionPageUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12 }}
            >
              Notion에서 열기 ↗
            </a>
          )}
          <button
            className="btn btn-accent"
            onClick={upload}
            disabled={uploading || !meeting?.notesMd}
            title={!meeting?.notesMd ? '회의록이 작성된 뒤 업로드할 수 있습니다' : ''}
          >
            {uploading ? '업로드 중…' : 'Notion에 업로드'}
          </button>
          <MenuButton
            disabled={!meeting}
            items={[
              {
                label: '오디오 파일 열기',
                disabled: !meeting?.audioPath,
                onClick: openAudio
              },
              {
                label: '회의록 내보내기 (.md)',
                disabled: !meeting?.notesMd,
                onClick: exportNotes
              },
              {
                label: '다시 처리 (전사/요약)',
                disabled: !meeting?.audioPath || processing,
                onClick: reprocess
              },
              { separator: true },
              {
                label: '삭제',
                danger: true,
                onClick: deleteMeeting
              }
            ]}
          />
        </div>
      </header>
      <div className="main-content">
        {actionError && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius)',
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              fontSize: 12,
              marginBottom: 16
            }}
          >
            {actionError}
          </div>
        )}
        {!meeting ? (
          <div className="muted">불러오는 중…</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateRows: 'auto 1fr',
              gap: 16,
              height: '100%'
            }}
          >
            <AudioPlayer meetingId={meeting.id} hasAudio={!!meeting.audioPath} />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 24,
                minHeight: 0
              }}
            >
            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <h3 style={{ fontSize: 13, marginBottom: 10, color: 'var(--text-muted)' }}>
                전사본
              </h3>
              <div
                className="card"
                style={{ flex: 1, overflow: 'auto', display: 'grid', gap: 10, padding: 16 }}
              >
                {/* Transcript-section status only while transcription itself
                    is in flight. Once segments land we hand off to the notes
                    section's spinner — no more status noise here. */}
                {segments.length === 0 && status?.stage === 'transcribing' && (
                  <div className="notes-spinner" style={{ minHeight: 120 }}>
                    <span className="notes-spinner-ring" aria-hidden />
                    <span className="notes-spinner-label">
                      {status.message ?? '전사 중…'}
                    </span>
                  </div>
                )}
                {segments.length === 0 && status?.stage !== 'transcribing' && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    전사된 내용이 아직 없습니다.
                  </div>
                )}
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    style={{ display: 'grid', gridTemplateColumns: '52px 72px 1fr', gap: 10 }}
                  >
                    <span
                      className="faint"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    >
                      {formatTime(seg.start)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: speakerColor(seg.speaker)
                      }}
                    >
                      {seg.speaker ?? ''}
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.7 }}>{seg.text}</span>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10
                }}
              >
                <h3 style={{ fontSize: 13, color: 'var(--text-muted)' }}>회의록</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  {editingNotes ? (
                    <>
                      <button
                        className="btn"
                        onClick={() => {
                          notesDirty.current = false
                          setNotesDraft(meeting.notesMd ?? '')
                          setEditingNotes(false)
                        }}
                        style={{ height: 24, padding: '0 10px' }}
                      >
                        취소
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={async () => {
                          await saveNotes()
                          setEditingNotes(false)
                        }}
                        style={{ height: 24, padding: '0 10px' }}
                      >
                        저장
                      </button>
                    </>
                  ) : (
                    meeting.notesMd && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setEditingNotes(true)}
                        style={{ height: 24, padding: '0 10px', fontSize: 12 }}
                      >
                        편집
                      </button>
                    )
                  )}
                </div>
              </div>

              {editingNotes ? (
                <textarea
                  className="card"
                  value={notesDraft}
                  onChange={(e) => {
                    notesDirty.current = true
                    setNotesDraft(e.target.value)
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    padding: 16,
                    fontSize: 13,
                    lineHeight: 1.7,
                    fontFamily: 'var(--font-sans)',
                    resize: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                />
              ) : (
                <div
                  className="card"
                  style={{ flex: 1, overflow: 'auto', padding: '14px 22px' }}
                >
                  {meeting.notesMd ? (
                    <div className="chat-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {meeting.notesMd}
                      </ReactMarkdown>
                    </div>
                  ) : notesSummarizing ? (
                    <div className="notes-spinner">
                      <span className="notes-spinner-ring" aria-hidden />
                      <span className="notes-spinner-label">회의록 작성 중…</span>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {meeting.transcriptJson
                        ? '회의록이 아직 생성되지 않았습니다. 우측 ⋯ 메뉴의 "다시 처리"를 눌러 주세요.'
                        : '아직 전사가 없습니다. 종료 후 자동으로 회의록이 작성됩니다.'}
                    </div>
                  )}
                </div>
              )}
            </section>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen upload veil — blurs everything underneath while
          either the auto-pipeline is in its `uploading` stage or the
          user manually clicked the upload button. */}
      {(uploading || status?.stage === 'uploading') && (
        <div className="upload-veil" role="status" aria-live="polite">
          <div className="upload-veil-card">
            <span className="notes-spinner-ring" aria-hidden />
            <span className="upload-veil-label">Notion에 업로드 중…</span>
          </div>
        </div>
      )}
    </div>
  )
}

const SPEAKER_PALETTE = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2'
]

function speakerColor(label: string | null): string {
  if (!label) return 'var(--text-faint)'
  const n = parseInt(label.replace(/\D/g, ''), 10) || 1
  return SPEAKER_PALETTE[(n - 1) % SPEAKER_PALETTE.length]
}

interface MenuItem {
  label?: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

function MenuButton({
  items,
  disabled
}: {
  items: MenuItem[]
  disabled?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="더보기"
        style={{ width: 32, padding: 0, fontSize: 16 }}
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 180,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 4,
            boxShadow: 'var(--shadow)',
            zIndex: 10,
            animation: 'fade-up 0.14s var(--ease-out)'
          }}
        >
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            ) : (
              <button
                key={i}
                onClick={() => {
                  setOpen(false)
                  item.onClick?.()
                }}
                disabled={item.disabled}
                className="btn-ghost"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: 13,
                  border: 'none',
                  background: 'transparent',
                  color: item.danger ? 'var(--danger)' : 'var(--text)',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  opacity: item.disabled ? 0.4 : 1,
                  borderRadius: 'var(--radius-sm)'
                }}
                onMouseEnter={(e) => {
                  if (item.disabled) return
                  e.currentTarget.style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
