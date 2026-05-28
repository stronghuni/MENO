import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Meeting, Project } from '../../../shared/types'
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
  const [projects, setProjects] = useState<Project[]>([])
  const [projectFilter, setProjectFilter] = useState<string>('all') // 'all' | 'none' | projectId
  const [createOpen, setCreateOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  useEffect(() => {
    const api = getApi()
    if (!api) {
      setLoading(false)
      return
    }
    void api.projects.list().then(setProjects)
    const load = (): void => {
      void api.projects.list().then(setProjects)
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

  const moveSelectedToProject = async (value: string): Promise<void> => {
    const api = getApi()
    if (!api || selected.size === 0 || !value) return
    const projectId = value === '__none' ? null : value
    const ids = Array.from(selected)
    await Promise.all(ids.map((id) => api.meetings.update(id, { projectId })))
    setSelected(new Set())
    const items = await api.meetings.list()
    setMeetings(items)
  }

  const addProject = async (): Promise<void> => {
    const api = getApi()
    const name = newProjectName.trim()
    if (!api || !name) return
    const p = await api.projects.create(name)
    setProjects((cur) => [...cur, p])
    setProjectFilter(p.id)
    setNewProjectName('')
    setCreateOpen(false)
  }

  const removeProject = async (id: string, name: string): Promise<void> => {
    const api = getApi()
    if (!api) return
    if (!confirm(`프로젝트 "${name}"을(를) 삭제할까요? 회의는 삭제되지 않고 미분류로 이동합니다.`)) return
    await api.projects.delete(id)
    setProjects((cur) => cur.filter((p) => p.id !== id))
    if (projectFilter === id) setProjectFilter('all')
    const items = await api.meetings.list()
    setMeetings(items)
  }

  const countFor = (key: string): number =>
    key === 'all'
      ? meetings.length
      : key === 'none'
        ? meetings.filter((m) => !m.projectId).length
        : meetings.filter((m) => m.projectId === key).length

  const visibleMeetings = meetings.filter((m) =>
    projectFilter === 'all'
      ? true
      : projectFilter === 'none'
        ? !m.projectId
        : m.projectId === projectFilter
  )

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
              <select
                className="select"
                style={{ width: 'auto' }}
                value=""
                onChange={(e) => void moveSelectedToProject(e.target.value)}
              >
                <option value="" disabled>
                  프로젝트로 이동…
                </option>
                <option value="__none">미분류로 빼기</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}(으)로
                  </option>
                ))}
              </select>
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
          <h1>라이브러리</h1>
        )}
      </header>
      <div className="main-content" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="muted" style={{ padding: 'var(--space-6)' }}>
            불러오는 중…
          </div>
        ) : (
          <div className="lib-console">
            {/* Left rail: project console */}
            <aside className="lib-rail">
              <div className="lib-rail-head">
                <span className="lib-rail-title">프로젝트</span>
                <button className="label-add" onClick={() => setCreateOpen(true)}>
                  + 프로젝트
                </button>
              </div>
              <button
                className={`lib-rail-item ${projectFilter === 'all' ? 'active' : ''}`}
                onClick={() => setProjectFilter('all')}
              >
                <span>전체</span>
                <span className="lib-rail-count">{countFor('all')}</span>
              </button>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`lib-rail-item ${projectFilter === p.id ? 'active' : ''}`}
                  onClick={() => setProjectFilter(p.id)}
                >
                  <span className="lib-rail-name">{p.name}</span>
                  <span className="lib-rail-count">{countFor(p.id)}</span>
                </button>
              ))}
              <button
                className={`lib-rail-item ${projectFilter === 'none' ? 'active' : ''}`}
                onClick={() => setProjectFilter('none')}
              >
                <span>미분류</span>
                <span className="lib-rail-count">{countFor('none')}</span>
              </button>
            </aside>

            {/* Right: meeting grid for the selected project */}
            <div className="lib-console-main">
              {(() => {
                const cur = projects.find((p) => p.id === projectFilter)
                return cur ? (
                  <div className="lib-console-head">
                    <span className="lib-console-head-title">{cur.name}</span>
                    <button
                      className="btn btn-ghost lib-proj-del"
                      onClick={() => removeProject(cur.id, cur.name)}
                    >
                      프로젝트 삭제
                    </button>
                  </div>
                ) : null
              })()}
              {visibleMeetings.length === 0 ? (
                <div className="empty-state">
                  <h2>{meetings.length === 0 ? '아직 회의가 없습니다' : '이 프로젝트에 회의가 없습니다'}</h2>
                  <p>
                    {meetings.length === 0
                      ? '새 회의를 녹음하면 여기에 카드로 쌓입니다.'
                      : '새 회의를 만들 때 이 프로젝트를 선택하면 여기 모입니다.'}
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: 14
                  }}
                >
                  {visibleMeetings.map((m) => {
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
        )}
      </div>

      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)} role="presentation">
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
                if (e.key === 'Escape') setCreateOpen(false)
              }}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={addProject} disabled={!newProjectName.trim()}>
                만들기
              </button>
            </div>
          </div>
        </div>
      )}
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
