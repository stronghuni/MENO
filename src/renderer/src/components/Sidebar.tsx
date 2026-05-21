import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import appIcon from '../assets/app-icon.png'
import { getApi } from '../lib/api'
import { applyTheme, resolveEffective } from '../lib/theme'
import { useRecording } from '../contexts/RecordingContext'
import type { Meeting, ThemeMode } from '../../../shared/types'

function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

// Lucide-style sun icon, 16x16 to match other nav icons.
function SunIcon(): React.JSX.Element {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

// Lucide-style moon icon for the dark state.
function MoonIcon(): React.JSX.Element {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

export default function Sidebar(): React.JSX.Element {
  const [recent, setRecent] = useState<Meeting[]>([])
  const [theme, setTheme] = useState<ThemeMode>('auto')
  const rec = useRecording()

  useEffect(() => {
    const api = getApi()
    if (!api) return
    const load = (): void => {
      void api.meetings.list().then((items) => setRecent(items.slice(0, 5)))
    }
    load()
    const unsubMeetings = api.meetings.onChanged(load)
    void api.settings.load().then((s) => setTheme(s.theme ?? 'auto'))
    return unsubMeetings
  }, [])

  const toggleTheme = async (): Promise<void> => {
    // Three-step cycle: auto → dark → light → auto. From any user-explicit
    // state we go back to auto on the next click so the OS preference can
    // take over again.
    const next: ThemeMode = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto'
    setTheme(next)
    applyTheme(next)
    const api = getApi()
    if (api) await api.settings.save({ theme: next })
  }

  const effective = resolveEffective(theme)
  const label = theme === 'auto' ? '자동 (OS)' : theme === 'dark' ? '다크모드' : '라이트모드'

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <img src={appIcon} alt="" className="sidebar-brand-logo" />
        MENO
      </div>

      <NavLink to="/new" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
        <span className={`nav-dot ${rec.isRecording ? 'live' : ''}`} />
        {rec.isRecording ? (rec.isPaused ? '회의 일시정지' : '회의 중') : '새 회의'}
      </NavLink>

      <NavLink
        to="/chat"
        className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      >
        <Icon>
          <path d="M3 4.5h10a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5H7l-3 2.5v-2.5H3a1.5 1.5 0 01-1.5-1.5V6A1.5 1.5 0 013 4.5z" />
        </Icon>
        채팅
      </NavLink>

      <NavLink
        to="/library"
        className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      >
        <Icon>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
          <path d="M5 6h6M5 9h4" />
        </Icon>
        라이브러리
      </NavLink>

      <NavLink
        to="/settings"
        className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      >
        <Icon>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 2.5v1.6M8 11.9v1.6M13.5 8h-1.6M4.1 8H2.5M11.9 4.1l-1.13 1.13M5.23 10.77L4.1 11.9M11.9 11.9l-1.13-1.13M5.23 5.23L4.1 4.1" />
        </Icon>
        설정
      </NavLink>

      {recent.length > 0 && (
        <>
          <div className="sidebar-section">최근</div>
          {recent.map((m) => (
            <NavLink
              key={m.id}
              to={`/meeting/${m.id}`}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-recent active' : 'nav-link nav-recent'
              }
            >
              <span
                className="nav-icon"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: m.notionPageUrl
                    ? 'var(--success)'
                    : m.notesMd
                      ? 'var(--accent)'
                      : 'var(--text-faint)',
                  flexShrink: 0
                }}
                aria-hidden
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {m.title}
              </span>
            </NavLink>
          ))}
        </>
      )}

      <div className="sidebar-spacer" style={{ flex: 1 }} aria-hidden />

      <button
        type="button"
        onClick={toggleTheme}
        className="theme-toggle"
        title={`현재: ${label} — 클릭하면 ${theme === 'auto' ? '다크' : theme === 'dark' ? '라이트' : '자동'} 모드`}
      >
        {effective === 'dark' ? <MoonIcon /> : <SunIcon />}
        <span>다크모드</span>
      </button>
    </nav>
  )
}
