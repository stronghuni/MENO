import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useMicrophone } from '../hooks/useMicrophone'
import { getApi } from '../lib/api'
import type { TranscriptSegment } from '../../../shared/types'

/**
 * Recording session lives at the App level so the microphone graph
 * survives route changes. Earlier the mic + meeting state lived inside
 * the NewMeeting route — navigating to Library/Settings unmounted that
 * component and killed the AudioContext mid-recording. Lifting it here
 * means the user can hop between routes while a recording is active and
 * the sidebar can show a persistent "회의 중" indicator.
 */

export interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  meetingId: string | null
  meetingTitle: string | null
  elapsedMs: number
  level: number
  /** Live FFT analyser; null until start() resolves. See useMicrophone.ts. */
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  partialSegments: TranscriptSegment[]
  devices: { deviceId: string; label: string }[]
  selectedDeviceId: string | null
  setSelectedDeviceId: (id: string) => void
  micError: string | null
  watchdog: string | null
  start: (input: {
    title: string
    startedAt?: number
    attendees?: string[]
    projectId?: string | null
  }) => Promise<void>
  stop: () => Promise<{ meetingId: string } | null>
  pause: () => Promise<void>
  resume: () => Promise<void>
}

const RecordingContext = createContext<RecordingState | null>(null)

export function useRecording(): RecordingState {
  const ctx = useContext(RecordingContext)
  if (!ctx) throw new Error('useRecording must be used inside <RecordingProvider>')
  return ctx
}

export function RecordingProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [partialSegments, setPartialSegments] = useState<TranscriptSegment[]>([])
  const [watchdog, setWatchdog] = useState<string | null>(null)
  const meetingIdRef = useRef<string | null>(null)
  meetingIdRef.current = meetingId
  const startTimeRef = useRef<number>(0)
  const pausedAtRef = useRef<number | null>(null)
  const pausedAccumRef = useRef<number>(0)

  const handleChunk = useCallback((pcm: Float32Array) => {
    const id = meetingIdRef.current
    const api = getApi()
    if (!id || !api) return
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
    void api.recording.chunk(id, buf)
  }, [])

  const mic = useMicrophone({ onChunk: handleChunk })

  // Subscribe to partial transcript updates for the current meeting.
  useEffect(() => {
    const api = getApi()
    if (!api) return
    return api.processing.onUpdate((s) => {
      if (s.meetingId !== meetingIdRef.current) return
      if (s.stage === 'transcribing' && s.partialSegments) {
        setPartialSegments(s.partialSegments)
      }
    })
  }, [])

  // Subscribe to watchdog (long-recording warnings, auto-stop).
  useEffect(() => {
    const api = getApi()
    if (!api) return
    return api.recording.onWatchdog((e) => {
      if (e.meetingId !== meetingIdRef.current) return
      setWatchdog(e.message)
      if (e.severity === 'stop') void stop()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Timer — accumulates while not paused.
  useEffect(() => {
    if (!mic.isRecording) return
    const id = setInterval(() => {
      if (pausedAtRef.current !== null) return
      setElapsedMs(Date.now() - startTimeRef.current - pausedAccumRef.current)
    }, 250)
    return () => clearInterval(id)
  }, [mic.isRecording])

  const start = useCallback(
    async (input: {
      title: string
      startedAt?: number
      attendees?: string[]
      projectId?: string | null
    }): Promise<void> => {
      const api = getApi()
      if (!api || mic.isRecording) return
      const meeting = await api.meetings.create(input)
      await api.recording.start({ meetingId: meeting.id, sampleRate: 16000 })
      setMeetingId(meeting.id)
      setMeetingTitle(meeting.title)
      setPartialSegments([])
      setWatchdog(null)
      startTimeRef.current = Date.now()
      pausedAccumRef.current = 0
      pausedAtRef.current = null
      setElapsedMs(0)
      await mic.start()
    },
    [mic]
  )

  const stop = useCallback(async (): Promise<{ meetingId: string } | null> => {
    const api = getApi()
    const id = meetingIdRef.current
    if (!api || !id || !mic.isRecording) return null
    await mic.stop()
    const finalized = await api.recording.stop(id)
    setMeetingId(null)
    setMeetingTitle(null)
    pausedAtRef.current = null
    setPartialSegments([])
    setWatchdog(null)
    return { meetingId: finalized.id }
  }, [mic])

  const pause = useCallback(async (): Promise<void> => {
    const api = getApi()
    const id = meetingIdRef.current
    if (!api || !id || !mic.isRecording || mic.isPaused) return
    await api.recording.pause(id)
    await mic.pause()
    pausedAtRef.current = Date.now()
  }, [mic])

  const resume = useCallback(async (): Promise<void> => {
    const api = getApi()
    const id = meetingIdRef.current
    if (!api || !id || !mic.isRecording || !mic.isPaused) return
    await api.recording.resume(id)
    await mic.resume()
    if (pausedAtRef.current !== null) {
      pausedAccumRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = null
    }
  }, [mic])

  const value: RecordingState = {
    isRecording: mic.isRecording,
    isPaused: mic.isPaused,
    meetingId,
    meetingTitle,
    elapsedMs,
    level: mic.level,
    analyserRef: mic.analyserRef,
    partialSegments,
    devices: mic.devices,
    selectedDeviceId: mic.selectedDeviceId,
    setSelectedDeviceId: mic.setSelectedDeviceId,
    micError: mic.error,
    watchdog,
    start,
    stop,
    pause,
    resume
  }

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>
}
