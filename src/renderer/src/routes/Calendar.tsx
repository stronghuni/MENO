import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Meeting, Project, ScheduledEvent } from '../../../shared/types'
import { getApi } from '../lib/api'
import { projectColor, NO_PROJECT_COLOR } from '../lib/projectColor'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function toLocalInput(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Calendar(): React.JSX.Element {
  const api = getApi()
  const navigate = useNavigate()
  const today = new Date()
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [events, setEvents] = useState<ScheduledEvent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<string | null>(dayKeyOf(today))
  const [projectFilter, setProjectFilter] = useState<string>('all') // 'all' | 'none' | projectId

  // modal
  const [open, setOpen] = useState(false)
  const [mTitle, setMTitle] = useState('')
  const [mWhen, setMWhen] = useState(() => toLocalInput(new Date()))
  const [mProject, setMProject] = useState('')

  const load = async (): Promise<void> => {
    if (!api) return
    const [ms, ev, ps] = await Promise.all([
      api.meetings.list() as Promise<Meeting[]>,
      api.events.list() as Promise<ScheduledEvent[]>,
      api.projects.list() as Promise<Project[]>
    ])
    setMeetings(ms)
    setEvents(ev)
    setProjects(ps)
  }

  useEffect(() => {
    void load()
    if (!api) return
    const off1 = api.events.onChanged(() => void load())
    const off2 = api.meetings.onChanged(() => void load())
    return () => {
      off1()
      off2()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const matchesFilter = (pid: string | null): boolean =>
    projectFilter === 'all'
      ? true
      : projectFilter === 'none'
        ? !pid
        : pid === projectFilter

  // Group items by local day (respecting the project filter).
  const byDay = useMemo(() => {
    const map = new Map<string, { meetings: Meeting[]; events: ScheduledEvent[] }>()
    const get = (k: string): { meetings: Meeting[]; events: ScheduledEvent[] } => {
      let v = map.get(k)
      if (!v) {
        v = { meetings: [], events: [] }
        map.set(k, v)
      }
      return v
    }
    for (const m of meetings) if (matchesFilter(m.projectId)) get(dayKey(m.startedAt)).meetings.push(m)
    for (const e of events) if (matchesFilter(e.projectId)) get(dayKey(e.scheduledAt)).events.push(e)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, events, projectFilter])

  // Build the month grid (weeks of 7, starting Sunday).
  const cells = useMemo(() => {
    const y = cursor.getFullYear()
    const mo = cursor.getMonth()
    const first = new Date(y, mo, 1)
    const start = new Date(y, mo, 1 - first.getDay())
    const out: Date[] = []
    for (let i = 0; i < 42; i++) {
      out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
    }
    // trim trailing all-next-month week if unused
    return out
  }, [cursor])

  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`
  const shiftMonth = (delta: number): void =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))

  const selectedItems = selected ? byDay.get(selected) : undefined
  const projName = (id: string | null): string | null =>
    id ? (projects.find((p) => p.id === id)?.name ?? null) : null

  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const colorFor = (pid: string | null): string =>
    pid ? projectColor(projById.get(pid)) : NO_PROJECT_COLOR
  const chipStyle = (pid: string | null): React.CSSProperties => {
    const c = colorFor(pid)
    return { background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }
  }

  const addEvent = async (): Promise<void> => {
    if (!api || !mTitle.trim() || !mWhen) return
    await api.events.create({
      title: mTitle.trim(),
      scheduledAt: new Date(mWhen).getTime(),
      projectId: mProject || null,
      auto: false
    })
    setOpen(false)
    setMTitle('')
    setMProject('')
  }

  const removeEvent = async (id: string): Promise<void> => {
    if (!api) return
    await api.events.delete(id)
  }

  const openAdd = (): void => {
    // default to the selected day at 14:00, else now
    if (selected) {
      const [yy, mm, dd] = selected.split('-').map(Number)
      setMWhen(toLocalInput(new Date(yy, mm, dd, 14, 0)))
    } else {
      setMWhen(toLocalInput(new Date()))
    }
    setOpen(true)
  }

  return (
    <div className="main">
      <header className="main-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1>캘린더</h1>
          <div className="cal-nav">
            <button onClick={() => shiftMonth(-1)} aria-label="이전 달">
              ‹
            </button>
            <button
              className="cal-today"
              onClick={() => {
                const n = new Date()
                setCursor(new Date(n.getFullYear(), n.getMonth(), 1))
                setSelected(dayKeyOf(n))
              }}
            >
              오늘
            </button>
            <button onClick={() => shiftMonth(1)} aria-label="다음 달">
              ›
            </button>
          </div>
          <span className="cal-month">{monthLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {projects.length > 0 && (
            <select
              className="select"
              style={{ width: 'auto' }}
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="all">전체 프로젝트</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="none">미분류</option>
            </select>
          )}
          <button className="btn btn-primary" onClick={openAdd}>
            + 일정 추가
          </button>
        </div>
      </header>

      <div className="main-content" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="cal-layout">
          <div className="cal-grid-wrap">
            <div className="cal-weekdays">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`cal-weekday ${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}`}>
                  {w}
                </div>
              ))}
            </div>
            <div className="cal-grid">
              {cells.map((d) => {
                const k = dayKeyOf(d)
                const items = byDay.get(k)
                const inMonth = d.getMonth() === cursor.getMonth()
                const isToday = dayKeyOf(today) === k
                return (
                  <button
                    key={k}
                    className={`cal-cell ${inMonth ? '' : 'dim'} ${selected === k ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                    onClick={() => setSelected(k)}
                  >
                    <span className="cal-daynum">{d.getDate()}</span>
                    <div className="cal-marks">
                      {items?.meetings.slice(0, 2).map((m) => (
                        <span key={m.id} className="cal-mark past" style={chipStyle(m.projectId)} title={m.title}>
                          {m.title}
                        </span>
                      ))}
                      {items?.events.slice(0, 2).map((e) => (
                        <span key={e.id} className="cal-mark" style={chipStyle(e.projectId)} title={e.title}>
                          {e.title}
                        </span>
                      ))}
                      {items && items.meetings.length + items.events.length > 4 && (
                        <span className="cal-more">+{items.meetings.length + items.events.length - 4}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
            {projects.length > 0 && (
              <div className="cal-legend">
                {projects.map((p) => (
                  <span key={p.id} className="cal-legend-item">
                    <i style={{ background: colorFor(p.id) }} />
                    {p.name}
                  </span>
                ))}
                <span className="cal-legend-item">
                  <i style={{ background: NO_PROJECT_COLOR }} />
                  미분류
                </span>
              </div>
            )}
          </div>

          {/* Selected-day detail */}
          <aside className="cal-detail">
            <div className="cal-detail-head">
              {selected
                ? (() => {
                    const [yy, mm, dd] = selected.split('-').map(Number)
                    const d = new Date(yy, mm, dd)
                    return `${mm + 1}월 ${dd}일 (${WEEKDAYS[d.getDay()]})`
                  })()
                : '날짜 선택'}
            </div>
            {!selectedItems || (selectedItems.meetings.length === 0 && selectedItems.events.length === 0) ? (
              <p className="muted" style={{ fontSize: 13 }}>
                이 날 회의/일정이 없습니다.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {selectedItems.events
                  .slice()
                  .sort((a, b) => a.scheduledAt - b.scheduledAt)
                  .map((e) => (
                    <div
                      key={e.id}
                      className="cal-item event"
                      style={{ borderLeft: `3px solid ${colorFor(e.projectId)}` }}
                    >
                      <div className="cal-item-top">
                        <span className="cal-item-time">{fmtTime(e.scheduledAt)}</span>
                        {e.auto && <span className="cal-badge">자동</span>}
                        <button
                          className="cal-item-del"
                          title="일정 삭제"
                          onClick={() => removeEvent(e.id)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="cal-item-title">{e.title}</div>
                      {projName(e.projectId) && (
                        <div className="cal-item-sub">{projName(e.projectId)}</div>
                      )}
                      {e.sourceMeetingId && (
                        <button
                          className="cal-item-link"
                          onClick={() => navigate(`/meeting/${e.sourceMeetingId}`)}
                        >
                          출처 회의 보기 →
                        </button>
                      )}
                    </div>
                  ))}
                {selectedItems.meetings
                  .slice()
                  .sort((a, b) => a.startedAt - b.startedAt)
                  .map((m) => (
                    <button
                      key={m.id}
                      className="cal-item meeting"
                      style={{ borderLeft: `3px solid ${colorFor(m.projectId)}` }}
                      onClick={() => navigate(`/meeting/${m.id}`)}
                    >
                      <div className="cal-item-top">
                        <span className="cal-item-time">{fmtTime(m.startedAt)}</span>
                        <span className="cal-badge done">완료</span>
                      </div>
                      <div className="cal-item-title">{m.title}</div>
                    </button>
                  ))}
              </div>
            )}
          </aside>
        </div>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">일정 추가</h3>
            <label className="label">제목</label>
            <input
              className="input"
              autoFocus
              placeholder="예: 제품팀 주간 회의"
              value={mTitle}
              onChange={(e) => setMTitle(e.target.value)}
            />
            <label className="label" style={{ marginTop: 12 }}>
              날짜 · 시간
            </label>
            <input
              className="input"
              type="datetime-local"
              value={mWhen}
              onChange={(e) => setMWhen(e.target.value)}
            />
            <label className="label" style={{ marginTop: 12 }}>
              프로젝트
            </label>
            <select className="select" value={mProject} onChange={(e) => setMProject(e.target.value)}>
              <option value=""></option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={addEvent} disabled={!mTitle.trim() || !mWhen}>
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
