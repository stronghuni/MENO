import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getApi } from '../lib/api'
import type { ChatMessage, Meeting } from '../../../shared/types'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const SUGGESTIONS = [
  '이번 주 결정된 사항 모아줘',
  '내가 맡은 액션 아이템만 정리해줘',
  '제일 자주 등장한 키워드 5개',
  '최근 회의에서 미해결로 남은 안건은?'
]

// Lucide-style icons inlined so we don't pull in the whole lucide-react
// package just for two glyphs. Both follow Lucide's 24×24 / stroke 2 conventions.
function PlusIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function ArrowUpIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  )
}

export default function Chat(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  // Rotating empty-state suggestion: one shown at a time, swapped every
  // 3 seconds with a quick fade. visibilityState drives the CSS class.
  const [suggestionIdx, setSuggestionIdx] = useState(0)
  const [suggestionVisible, setSuggestionVisible] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const api = getApi()
    if (!api) return
    void api.chat.history().then((h) => setMessages(h ?? []))
    void api.meetings.list().then(setMeetings)
    const off = api.meetings.onChanged(() => {
      void api.meetings.list().then(setMeetings)
    })
    return off
  }, [])

  useEffect(() => {
    const api = getApi()
    if (!api) return
    return api.chat.onToken((e) => {
      const ev = e as { content: string; done: boolean }
      setStreamingText(ev.content)
      if (ev.done) setStreaming(false)
    })
  }, [])

  useEffect(() => {
    const api = getApi()
    if (!api) return
    return api.chat.onUpdate((e) => {
      const ev = e as { history: ChatMessage[] }
      setMessages(ev.history)
      setStreamingText('')
    })
  }, [])

  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, streamingText])

  // Auto-grow the single-row textarea up to ~5 lines, then scroll.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  }, [draft])

  const toggleMeeting = (id: string): void => {
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  const send = async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    const text = draft.trim()
    if (!text || streaming) return
    setError(null)
    setDraft('')
    setStreaming(true)
    setStreamingText('')
    try {
      await api.chat.send({
        meetingIds: selected.length > 0 ? selected : null,
        message: text
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStreaming(false)
    }
  }

  const clearAll = async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    if (!confirm('대화 내역을 모두 삭제할까요?')) return
    await api.chat.clear()
    setMessages([])
    setStreamingText('')
  }

  const selectedMeetings = selected
    .map((id) => meetings.find((m) => m.id === id))
    .filter((m): m is Meeting => !!m)

  const scopeLabel =
    selected.length === 0
      ? '모든 회의'
      : selected.length === 1
        ? (selectedMeetings[0]?.title ?? '1건')
        : `${selected.length}건 선택됨`

  const isEmpty = messages.length === 0 && !streaming

  // Cycle the suggestion every 3s while empty. Each tick fades out for
  // ~350ms (matches the CSS transition), swaps the index, then fades
  // back in. Skip the interval entirely when we're not showing the
  // suggestion area — avoids unmount-time work and stray re-renders.
  useEffect(() => {
    if (!isEmpty) return
    const FADE_MS = 350
    const id = setInterval(() => {
      setSuggestionVisible(false)
      setTimeout(() => {
        setSuggestionIdx((i) => (i + 1) % SUGGESTIONS.length)
        setSuggestionVisible(true)
      }, FADE_MS)
    }, 3000)
    return () => clearInterval(id)
  }, [isEmpty])

  return (
    <div className="main">
      <header className="main-header">
        <h1>채팅</h1>
        {messages.length > 0 && (
          <button className="btn btn-ghost" onClick={clearAll} style={{ fontSize: 11 }}>
            대화 초기화
          </button>
        )}
      </header>

      <div className="chat-page">
        <div className="chat-scroll">
          {isEmpty ? (
            <div className="chat-center-hint">
              회의록 라이브러리 전체에 대해 질문하거나, + 버튼으로 특정 회의를 골라 그 안에서만
              답하게 할 수 있습니다.
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <ChatTurn key={`${m.ts}-${i}`} message={m} meetings={meetings} />
              ))}
              {streaming && streamingText && (
                <ChatTurn
                  message={{ role: 'assistant', content: streamingText, ts: Date.now() }}
                  meetings={meetings}
                />
              )}
              {streaming && !streamingText && (
                <div className="chat-thinking">
                  <span className="chat-thinking-dot" />
                  <span className="chat-thinking-dot" />
                  <span className="chat-thinking-dot" />
                </div>
              )}
              {error && <div className="chat-error">{error}</div>}
              <div ref={endRef} />
            </>
          )}
        </div>

        {isEmpty && (
          <div className="chat-suggestions">
            <button
              type="button"
              className={`chat-suggestion ${suggestionVisible ? '' : 'fading'}`}
              onClick={() => setDraft(SUGGESTIONS[suggestionIdx])}
            >
              {SUGGESTIONS[suggestionIdx]}
            </button>
          </div>
        )}

        {selected.length > 0 && (
          <div className="chat-scope-chips">
            {selectedMeetings.map((m) => (
              <span key={m.id} className="chip">
                {m.title}
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => toggleMeeting(m.id)}
                  aria-label="제거"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <div ref={pickerRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="chat-plus"
              onClick={() => setPickerOpen((v) => !v)}
              aria-label="회의 선택"
              title="이 질문의 대상 회의 선택"
            >
              <PlusIcon />
            </button>
            {pickerOpen && (
              <MeetingPicker
                meetings={meetings}
                selected={selected}
                onToggle={toggleMeeting}
                onClear={() => setSelected([])}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder={
              streaming
                ? '답변 생성 중…'
                : selected.length > 0
                  ? `${scopeLabel}에 대해 질문하세요`
                  : '모든 회의록에 대해 질문하세요'
            }
            disabled={streaming}
          />

          <button
            type="submit"
            className="chat-send"
            disabled={streaming || draft.trim().length === 0}
            aria-label="전송"
            title="전송"
          >
            <ArrowUpIcon />
          </button>
        </form>
      </div>
    </div>
  )
}

interface MeetingPickerProps {
  meetings: Meeting[]
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  onClose: () => void
}

function MeetingPicker({
  meetings,
  selected,
  onToggle,
  onClear,
  onClose
}: MeetingPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? meetings.filter((m) => m.title.toLowerCase().includes(query.toLowerCase()))
    : meetings

  return (
    <div className="chat-picker" role="dialog">
      <div className="chat-picker-header">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="회의 검색"
          className="chat-picker-search"
          autoFocus
        />
      </div>
      <div className="chat-picker-list">
        {filtered.length === 0 ? (
          <div className="chat-picker-empty">일치하는 회의가 없습니다</div>
        ) : (
          filtered.map((m) => {
            const isSel = selected.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={`chat-picker-row ${isSel ? 'selected' : ''}`}
                onClick={() => onToggle(m.id)}
              >
                <span className={`chat-picker-check ${isSel ? 'checked' : ''}`} aria-hidden>
                  {isSel && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 8.5l3.5 3.5L13 5"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="chat-picker-title">{m.title}</span>
                  <span className="chat-picker-date">{formatDate(m.startedAt)}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="chat-picker-footer">
        <span className="muted" style={{ fontSize: 11 }}>
          {selected.length === 0
            ? '선택하지 않으면 전체 회의가 대상'
            : `${selected.length}건 선택됨`}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {selected.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
              onClick={onClear}
            >
              해제
            </button>
          )}
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '2px 10px', height: 24 }}
            onClick={onClose}
          >
            완료
          </button>
        </div>
      </div>
    </div>
  )
}

interface ChatTurnProps {
  message: ChatMessage
  meetings: Meeting[]
}

function ChatTurn({ message, meetings }: ChatTurnProps): React.JSX.Element {
  if (message.role === 'user') {
    const scopeTitles = message.meetingIds
      ? message.meetingIds.map((id) => meetings.find((m) => m.id === id)?.title ?? '삭제된 회의')
      : []
    return (
      <div className="chat-turn user">
        {scopeTitles.length > 0 && (
          <div className="chat-turn-scope">범위: {scopeTitles.join(', ')}</div>
        )}
        <div className="chat-user-text">{message.content}</div>
      </div>
    )
  }
  return (
    <div className="chat-turn assistant">
      <div className="chat-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  )
}
