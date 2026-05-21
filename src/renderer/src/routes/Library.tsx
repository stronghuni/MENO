import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Meeting } from '../../../shared/types'
import { getApi } from '../lib/api'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`
}

interface BadgeSpec {
  label: string
  color: string
}

function statusBadge(m: Meeting): BadgeSpec {
  if (m.notionPageUrl) return { label: 'Notion ✓', color: 'var(--success)' }
  if (m.notesMd) return { label: '회의록', color: 'var(--accent)' }
  if (m.transcriptJson) return { label: '전사 완료', color: 'var(--text-muted)' }
  if (m.endedAt) return { label: '녹음 완료', color: 'var(--text-faint)' }
  return { label: '진행 중', color: 'var(--danger)' }
}

export default function Library(): React.JSX.Element {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const api = getApi()
    if (!api) {
      setLoading(false)
      return
    }
    const load = (): void => {
      void api.meetings.list().then((items) => {
        setMeetings(items)
        setLoading(false)
        // Drop selections that point at meetings that no longer exist
        // (e.g. deleted from another window or auto-cleaned).
        setSelected((prev) => {
          if (prev.size === 0) return prev
          const valid = new Set(items.map((m) => m.id))
          const next = new Set<string>()
          for (const id of prev) if (valid.has(id)) next.add(id)
          return next.size === prev.size ? prev : next
        })
      })
    }
    load()
    return api.meetings.onChanged(load)
  }, [])

  const toggleOne = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = (): void => {
    setSelected((prev) =>
      prev.size === meetings.length ? new Set() : new Set(meetings.map((m) => m.id))
    )
  }

  const clearSelection = (): void => setSelected(new Set())

  const deleteSelected = async (): Promise<void> => {
    const api = getApi()
    if (!api || selected.size === 0) return
    const ids = Array.from(selected)
    const ok = confirm(
      `선택한 ${ids.length}개 회의를 삭제할까요? 오디오 파일도 함께 삭제됩니다.`
    )
    if (!ok) return
    setDeleting(true)
    try {
      await api.meetings.deleteMany(ids)
      setSelected(new Set())
    } finally {
      setDeleting(false)
    }
  }

  const inSelectMode = selected.size > 0
  const allSelected = meetings.length > 0 && selected.size === meetings.length

  return (
    <div className="main">
      <header className="main-header">
        {inSelectMode ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                className="btn btn-ghost"
                onClick={clearSelection}
                aria-label="선택 해제"
                title="선택 해제"
                style={{ width: 28, height: 28, padding: 0, fontSize: 18 }}
              >
                ✕
              </button>
              <h1 style={{ fontSize: 14 }}>{selected.size}개 선택됨</h1>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn" onClick={toggleAll}>
                {allSelected ? '전체 선택 해제' : '전체 선택'}
              </button>
              <button
                className="btn btn-danger"
                onClick={deleteSelected}
                disabled={deleting}
              >
                {deleting ? '삭제 중…' : `선택 삭제 (${selected.size})`}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>라이브러리</h1>
            <span className="muted" style={{ fontSize: 12 }}>
              {meetings.length}개
            </span>
          </>
        )}
      </header>
      <div className="main-content">
        {loading ? (
          <div className="muted">불러오는 중…</div>
        ) : meetings.length === 0 ? (
          <div className="empty-state">
            <h2>아직 회의가 없습니다</h2>
            <p>새 회의를 녹음하면 여기에 카드로 쌓입니다. 검색·필터도 늘어날수록 유용합니다.</p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 14
            }}
          >
            {meetings.map((m) => {
              const badge = statusBadge(m)
              const isSelected = selected.has(m.id)
              return (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  badge={badge}
                  selected={isSelected}
                  selectMode={inSelectMode}
                  onToggle={() => toggleOne(m.id)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface MeetingCardProps {
  meeting: Meeting
  badge: BadgeSpec
  selected: boolean
  selectMode: boolean
  onToggle: () => void
}

function MeetingCard({
  meeting: m,
  badge,
  selected,
  selectMode,
  onToggle
}: MeetingCardProps): React.JSX.Element {
  // Clicking the card body navigates to detail except while in select
  // mode, where the whole card acts as a toggle for a quicker batch
  // workflow.
  const handleCardClick = (e: React.MouseEvent): void => {
    if (!selectMode) return
    e.preventDefault()
    onToggle()
  }

  return (
    <Link
      to={`/meeting/${m.id}`}
      className={`meeting-card${selected ? ' selected' : ''}`}
      onClick={handleCardClick}
    >
      <button
        type="button"
        className={`meeting-card-check${selected ? ' checked' : ''}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onToggle()
        }}
        aria-label={selected ? '선택 해제' : '선택'}
        title={selected ? '선택 해제' : '선택'}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 8.5l3.5 3.5L13 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <div style={{ fontWeight: 600, fontSize: 13.5, paddingRight: 28 }}>{m.title}</div>
      <div className="faint" style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
        {formatDate(m.startedAt)} · {formatDuration(m.durationMs)}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <span className="badge" style={{ color: badge.color }}>
          {badge.label}
        </span>
      </div>
    </Link>
  )
}
