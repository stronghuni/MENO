import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  meetingId: string
  /** True if the meeting has an audio file. When false we render a
   *  disabled placeholder instead of trying to load. */
  hasAudio: boolean
}

const SPEEDS = [1, 1.5, 2] as const

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '00:00'
  const total = Math.floor(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

/**
 * Music-player-style transport for meeting audio. Large round play
 * button, a linear scrub bar with click/drag seeking, 10s rewind,
 * and a 1× / 1.5× / 2× speed toggle.
 *
 * The waveform-visualization variant was rolled back at the user's
 * request — a flat scrubber is cleaner and quicker to read.
 */
export default function AudioPlayer({ meetingId, hasAudio }: Props): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState<number>(1)
  // While the user is dragging the scrubber we drive the displayed
  // position from local state so the thumb doesn't jitter against
  // timeupdate events from the underlying <audio>.
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(0)

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = (): void => {
      if (!scrubbing) setCurrent(a.currentTime)
    }
    const onDur = (): void => {
      if (isFinite(a.duration)) setDuration(a.duration)
    }
    const onEnded = (): void => setPlaying(false)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('durationchange', onDur)
    a.addEventListener('loadedmetadata', onDur)
    a.addEventListener('ended', onEnded)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('durationchange', onDur)
      a.removeEventListener('loadedmetadata', onDur)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [scrubbing])

  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
  }, [meetingId])

  const toggle = useCallback((): void => {
    const a = audioRef.current
    if (!a || !hasAudio) return
    if (a.paused) void a.play()
    else a.pause()
  }, [hasAudio])

  const back10 = useCallback((): void => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, a.currentTime - 10)
  }, [])

  const setRate = useCallback((r: number): void => {
    const a = audioRef.current
    if (!a) return
    a.playbackRate = r
    setSpeed(r)
  }, [])

  const onScrubInput = (e: ChangeEvent<HTMLInputElement>): void => {
    setScrubValue(Number(e.target.value))
  }
  const onScrubStart = (): void => {
    setScrubbing(true)
    setScrubValue(current)
  }
  const onScrubEnd = (): void => {
    const a = audioRef.current
    if (a) a.currentTime = scrubValue
    setCurrent(scrubValue)
    setScrubbing(false)
  }

  // Keyboard shortcuts: Space toggles, ← rewinds 10s. Ignored while the
  // user is typing in inputs/textareas (notes editor, chat composer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!hasAudio) return
      const t = e.target as HTMLElement
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back10()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasAudio, toggle, back10])

  const displayedTime = scrubbing ? scrubValue : current
  const filledPct = duration > 0 ? (displayedTime / duration) * 100 : 0

  return (
    <div className={`mp ${!hasAudio ? 'disabled' : ''}`}>
      <button
        type="button"
        className="mp-play"
        onClick={toggle}
        disabled={!hasAudio}
        aria-label={playing ? '일시정지' : '재생'}
        title={playing ? '일시정지 (Space)' : '재생 (Space)'}
      >
        {playing ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6.5" y="5" width="4" height="14" rx="1" />
            <rect x="13.5" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.55.83l10-6.5a1 1 0 0 0 0-1.66l-10-6.5A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>

      <div className="mp-stage">
        <input
          type="range"
          className="mp-scrub"
          min={0}
          max={duration || 0}
          step={0.01}
          value={displayedTime}
          onChange={onScrubInput}
          onMouseDown={onScrubStart}
          onMouseUp={onScrubEnd}
          onTouchStart={onScrubStart}
          onTouchEnd={onScrubEnd}
          disabled={!hasAudio || duration === 0}
          aria-label="재생 위치"
          style={{ '--filled': `${filledPct}%` } as React.CSSProperties}
        />
        <div className="mp-time-row">
          <span className="mp-time">{fmtTime(displayedTime)}</span>
          <span className="mp-time mp-time-dim">{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="mp-controls">
        <button
          type="button"
          className="mp-back"
          onClick={back10}
          disabled={!hasAudio}
          aria-label="10초 뒤로"
          title="10초 뒤로 (←)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 9-9" />
            <path d="M3 4v5h5" />
          </svg>
          <span>10</span>
        </button>

        <div className="mp-speeds" role="group" aria-label="재생 속도">
          {SPEEDS.map((r) => (
            <button
              key={r}
              type="button"
              className={`mp-speed ${speed === r ? 'active' : ''}`}
              onClick={() => setRate(r)}
              disabled={!hasAudio}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      {hasAudio && (
        <audio
          ref={audioRef}
          src={`meno-audio://${meetingId}`}
          preload="metadata"
        />
      )}
    </div>
  )
}
