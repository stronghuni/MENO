import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import OnboardingOverlay from './components/OnboardingOverlay'
import NewMeeting from './routes/NewMeeting'
import Library from './routes/Library'
import MeetingDetail from './routes/MeetingDetail'
import Settings from './routes/Settings'
import Chat from './routes/Chat'
import Connections from './routes/Connections'
import Calendar from './routes/Calendar'
import { getApi } from './lib/api'
import { applyTheme } from './lib/theme'
import { RecordingProvider } from './contexts/RecordingContext'

export default function App(): React.JSX.Element {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)

  useEffect(() => {
    const api = getApi()
    if (!api) {
      setOnboardingChecked(true)
      return
    }
    void (async (): Promise<void> => {
      const [settings, whisper, llm] = await Promise.all([
        api.settings.load(),
        api.models.whisperInstalled(),
        api.models.llmInstalled()
      ])
      applyTheme(settings.theme ?? 'auto')
      if (!settings.onboardingCompleted && !(whisper && llm)) {
        setShowOnboarding(true)
      }
      setOnboardingChecked(true)
    })()
  }, [])

  return (
    <RecordingProvider>
      <HashRouter>
        <div className="app-shell">
          <Sidebar />
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/new" replace />} />
              <Route path="/new" element={<NewMeeting />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/library" element={<Library />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/meeting/:id" element={<MeetingDetail />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </ErrorBoundary>
        </div>
        {onboardingChecked && showOnboarding && (
          <OnboardingOverlay onClose={() => setShowOnboarding(false)} />
        )}
      </HashRouter>
    </RecordingProvider>
  )
}
