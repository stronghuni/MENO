import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  Meeting,
  ProcessingStatus,
  RelatedMeeting,
  TranscriptSegment
} from '../../../shared/types'
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
  const [jiraSending, setJiraSending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [related, setRelated] = useState<RelatedMeeting[]>([])
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
    void api.graph.related(id).then(setRelated)
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
        // Graph is indexed at the end of the pipeline — refresh related.
        if (s.stage === 'done') void api.graph.related(id!).then(setRelated)
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

  const deleteMeeting = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      if (!confirm('이 회의를 삭제할까요? 오디오 파일도 함께 삭제됩니다.')) return
      await api.meetings.delete(id)
      navigate('/library')
    })

  const downloadAudio = (): Promise<void> =>
    runAction(async () => {
      if (!id || !meeting?.audioPath) return
      const api = getApi()
      if (!api) return
      await api.shell.downloadAudio(id)
    })

  const exportNotes = (format: 'md' | 'docx'): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      await api.shell.exportNotes(id, format)
    })

  const sendToJira = (): Promise<void> =>
    runAction(async () => {
      if (!id) return
      const api = getApi()
      if (!api) return
      setJiraSending(true)
      try {
        const res = await api.jira.export(id)
        if (res.total === 0) {
          window.alert('이 회의록에 보낼 액션 아이템이 없습니다.')
          return
        }
        const lines = res.created.map((c) =>
          c.key ? `✓ ${c.key}  ${c.task}` : `✗ ${c.task} — ${c.error ?? '실패'}`
        )
        window.alert(`Jira 이슈 ${res.succeeded}/${res.total}개 생성됨\n\n${lines.join('\n')}`)
      } finally {
        setJiraSending(false)
      }
    })

  return (
    <div className="main">
      <header className="main-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(-1)}
            aria-label="뒤로"
            title="이전 페이지로"
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
              className="input title-edit-input"
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
            />
          ) : (
            <h1
              className="editable-title"
              onClick={() => {
                if (!meeting) return
                setTitleDraft(meeting.title)
                setEditingTitle(true)
              }}
              title="클릭해서 제목 편집"
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
            className="btn"
            onClick={sendToJira}
            disabled={jiraSending || !meeting?.notesMd}
            title={!meeting?.notesMd ? '회의록이 작성된 뒤 보낼 수 있습니다' : '액션 아이템을 Jira 이슈로 생성'}
          >
            {jiraSending ? '전송 중…' : 'Jira로 보내기'}
          </button>
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
                label: '오디오 파일 다운로드',
                disabled: !meeting?.audioPath,
                onClick: downloadAudio
              },
              {
                label: '회의록 내보내기',
                disabled: !meeting?.notesMd,
                submenu: [
                  { label: 'Markdown (.md)', onClick: () => exportNotes('md') },
                  { label: 'Word 문서 (.docx)', onClick: () => exportNotes('docx') }
                ]
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
              gridTemplateRows: related.length > 0 ? 'auto 1fr auto' : 'auto 1fr',
              gap: 16,
              height: '100%'
            }}
          >
            <AudioPlayer meetingId={meeting.id} hasAudio={!!meeting.audioPath} />
            <div
              style={{
                display: 'grid',
                // minmax(0, 1fr) on both columns: without this the markdown
                // table on the notes side blows past 50% and the transcript
                // column gets squeezed down to one character per line.
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
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
                  ) : status?.stage === 'summarizing' && status.notesPartial ? (
                    // Live streaming preview — render the partial buffer as
                    // markdown so the user watches the doc grow token-by-token.
                    <div className="chat-markdown notes-streaming">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {status.notesPartial}
                      </ReactMarkdown>
                      <span className="streaming-cursor" aria-hidden />
                    </div>
                  ) : notesSummarizing ? (
                    <div className="notes-spinner">
                      <span className="notes-spinner-ring" aria-hidden />
                      <span className="notes-spinner-label">회의록 작성 중…</span>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {meeting.transcriptJson
                        ? '회의록이 아직 생성되지 않았습니다.'
                        : '아직 전사가 없습니다. 종료 후 자동으로 회의록이 작성됩니다.'}
                    </div>
                  )}
                </div>
              )}
            </section>
            </div>

            {related.length > 0 && (
              <div className="md-related">
                <span className="md-related-label">관련 회의</span>
                <div className="md-related-list">
                  {related.map((r) => (
                    <button
                      key={r.id}
                      className="md-related-pill"
                      onClick={() => navigate(`/meeting/${r.id}`)}
                      title={r.shared.map((e) => e.name).join(', ')}
                    >
                      <span className="md-related-pill-title">{r.title}</span>
                      <span className="md-related-pill-shared">
                        {r.shared.slice(0, 3).map((e, i) => (
                          <span key={i} className={`conn-chip ${e.type}`}>
                            {e.type === 'person' ? '@' : '#'}
                            {e.name}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
  /** When present, the row opens a nested flyout on hover/click instead
   *  of firing onClick. */
  submenu?: { label: string; onClick: () => void }[]
}

const ROW_STYLE = (item: { disabled?: boolean; danger?: boolean }): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
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
})

function MenuButton({
  items,
  disabled
}: {
  items: MenuItem[]
  disabled?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [openSub, setOpenSub] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setOpenSub(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const close = (): void => {
    setOpen(false)
    setOpenSub(null)
  }

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
            minWidth: 200,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 4,
            boxShadow: 'var(--shadow)',
            zIndex: 10,
            animation: 'fade-up 0.14s var(--ease-out)'
          }}
        >
          {items.map((item, i) => {
            if (item.separator) {
              return (
                <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              )
            }
            if (item.submenu) {
              return (
                <div
                  key={i}
                  style={{ position: 'relative' }}
                  onMouseEnter={() => !item.disabled && setOpenSub(i)}
                  onMouseLeave={() => setOpenSub((cur) => (cur === i ? null : cur))}
                >
                  <button
                    type="button"
                    disabled={item.disabled}
                    onClick={() => !item.disabled && setOpenSub((cur) => (cur === i ? null : i))}
                    style={ROW_STYLE(item)}
                    onMouseEnter={(e) => {
                      if (item.disabled) return
                      e.currentTarget.style.background = 'var(--bg-hover)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span>{item.label}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>›</span>
                  </button>
                  {openSub === i && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: 'calc(100% + 4px)',
                        minWidth: 180,
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: 4,
                        boxShadow: 'var(--shadow)',
                        zIndex: 11,
                        animation: 'fade-up 0.12s var(--ease-out)'
                      }}
                    >
                      {item.submenu.map((sub, j) => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => {
                            close()
                            sub.onClick()
                          }}
                          style={ROW_STYLE({})}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-hover)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <span>{sub.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <button
                key={i}
                onClick={() => {
                  close()
                  item.onClick?.()
                }}
                disabled={item.disabled}
                style={ROW_STYLE(item)}
                onMouseEnter={(e) => {
                  if (item.disabled) return
                  e.currentTarget.style.background = 'var(--bg-hover)'
                  setOpenSub(null)
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
