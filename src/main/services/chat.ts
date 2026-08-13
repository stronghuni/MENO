import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { broadcast } from './broadcaster'
import { getMeeting, listMeetings } from './storage'
import { getModel, isLlmInstalled } from './summarizer'
import type { ChatMessage, Meeting } from '../../shared/types'

/**
 * Single global chat thread. The user picks which meetings to scope each
 * question to via the + button in the input — `meetingIds` either lists
 * those explicit selections, or is empty / null to mean "all meetings".
 *
 * One LlamaChatSession is kept alive per process at a time. Its system
 * prompt embeds the selected meetings' notes — never the raw transcript.
 * A 30-minute transcript is ~21 000 chars ≈ 15 000 Qwen tokens in Korean,
 * which overflows the context on its own; the notes carry the same
 * substance in a tenth of the budget. Switching scope rebuilds the
 * session so the LLM doesn't try to talk about meetings it was never shown.
 */

interface CachedChat {
  scopeKey: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
}

let cached: CachedChat | null = null

function getHistoryPath(): string {
  return join(app.getPath('userData'), 'chat.json')
}

export function getChatHistory(): ChatMessage[] {
  const p = getHistoryPath()
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ChatMessage[]
  } catch {
    return []
  }
}

function persistHistory(history: ChatMessage[]): void {
  writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2))
}

export function clearChatHistory(): void {
  persistHistory([])
  if (cached) {
    void cached.context?.dispose?.()
    cached = null
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface BuiltContext {
  prompt: string
  scopeKey: string
  meetings: { id: string; title: string }[]
}

function buildSystemPrompt(meetingIds: string[] | null): BuiltContext {
  const all = listMeetings()
  const selected: Meeting[] =
    meetingIds && meetingIds.length > 0
      ? all.filter((m) => meetingIds.includes(m.id))
      : all

  // Character budgets, sized against the 16 384-token context below.
  // Korean runs ~1.43 chars per Qwen token (measured), so 16 000 chars
  // ≈ 11 200 tokens — leaving the rules block, the chat history and the
  // 1024-token reply room inside the usable 14 746 (context minus the
  // 10 % context-shift reserve). Budget in chars, not tokens, because
  // that ratio is stable for Korean notes.
  const PER_MEETING = 6_000
  const MAX_TOTAL = 16_000

  const sections: string[] = []
  let used = 0
  for (const m of selected) {
    const head = `## [${m.title}] · ${formatDate(m.startedAt)}`
    const attendees = m.attendeesJson
      ? '참석자: ' + (JSON.parse(m.attendeesJson) as string[]).join(', ')
      : ''
    const tags = m.tagsJson
      ? '태그: ' + (JSON.parse(m.tagsJson) as string[]).join(', ')
      : ''
    const meta = [attendees, tags].filter(Boolean).join('\n')

    let body = m.notesMd ? '### 회의록\n' + m.notesMd : ''
    if (!body) body = '(아직 회의록이 작성되지 않았습니다.)'
    if (body.length > PER_MEETING) body = body.slice(0, PER_MEETING) + '\n…(이하 생략)'

    const section = [head, meta, body].filter(Boolean).join('\n')
    if (used + section.length > MAX_TOTAL) {
      sections.push(`…(이후 ${selected.length - sections.length}건의 회의록은 컨텍스트 한도로 생략됨)`)
      break
    }
    sections.push(section)
    used += section.length
  }

  const scopeLine = meetingIds && meetingIds.length > 0
    ? `선택된 ${meetingIds.length}개 회의에 한정해 답변하세요.`
    : `사용자가 회의를 따로 고르지 않았습니다. 라이브러리의 모든 회의(${selected.length}건) 중에서 가장 관련 있는 회의를 찾아 답하고, 어떤 회의에서 가져온 정보인지 회의 제목을 인용하세요.`

  const prompt = `당신은 회의록 어시스턴트입니다. 아래 회의 정보에 근거해서만 답합니다.

${scopeLine}

규칙:
1. 위 자료에서 도출 가능한 사실만 답하세요. 회의에 등장하지 않은 내용을 추측해서 만들어내지 마세요.
2. 회의와 무관한 일반 지식 질문(예: 날씨, 외부 정보, 코드 작성, 회의록 외부 사실)이 들어오면 아래 한 문장만, 정확히 그대로 출력하고 그 외에는 어떤 단어도 덧붙이지 마세요:

회의록과 관련된 질문에만 답해드릴 수 있습니다.

3. 한국어 존댓말로 답하세요.
4. 답변은 마크다운으로 작성하세요. 굵게(**), 인용(>), 목록(-), 표를 자유롭게 사용. 코드 블록(\`\`\`)은 쓰지 마세요.
5. 가능하면 어느 회의에서 가져온 정보인지 회의 제목으로 짧게 명시하세요 — 예: "[제품 회의 5/21]". 자료에는 회의록만 있고 전사본·타임스탬프·화자 정보는 없으므로, 시각이나 화자를 지어내지 마세요.
6. 모르거나 회의록에 명시되지 않은 정보는 솔직히 "회의록에 명시되지 않았습니다"라고 답하세요.

회의 자료:
${sections.join('\n\n---\n\n') || '(라이브러리에 회의가 없습니다.)'}`

  const scopeKey =
    meetingIds && meetingIds.length > 0
      ? 'scoped:' + [...meetingIds].sort().join(',')
      : `all:${all.map((m) => m.id + ':' + m.updatedAt).join(',')}`

  return {
    prompt,
    scopeKey,
    meetings: selected.map((m) => ({ id: m.id, title: m.title }))
  }
}

async function getOrCreateSession(meetingIds: string[] | null): Promise<CachedChat> {
  const built = buildSystemPrompt(meetingIds)
  if (cached && cached.scopeKey === built.scopeKey) return cached
  if (cached) {
    try {
      await cached.context?.dispose?.()
    } catch {
      // ignore
    }
  }
  if (!isLlmInstalled()) throw new Error('요약 모델이 설치되지 않았습니다.')
  const { LlamaChatSession } = await import('node-llama-cpp')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (await getModel()) as any
  const context = await model.createContext({ contextSize: 16384 })
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: built.prompt
  })
  cached = { scopeKey: built.scopeKey, session, context }
  return cached
}

export interface SendArgs {
  meetingIds: string[] | null
  message: string
}

const REFUSAL_CANONICAL = '회의록과 관련된 질문에만 답해드릴 수 있습니다.'
// Tolerant pattern that catches the common variants the LLM emits even
// after being explicitly instructed: leading "이/이런", missing 받침,
// optional 드릴, trailing punctuation, etc.
const REFUSAL_PATTERN =
  /(?:이|이런)?\s*회의록과?\s*관련된?\s*질문에(?:만|는)?\s*답(?:해|만)?\s*(?:드릴|하)?(?:\s*수)?\s*있?(?:습니다|어요|네요)?[.!]?/

/**
 * If the LLM tried to refuse but added extra commentary or used a slight
 * wording variant, snap it back to the canonical phrasing. We only do
 * this when the response is short enough that the refusal sentence is
 * the entire answer — longer responses are left untouched so genuine
 * citations of "회의록과 관련된" wording in legitimate answers aren't
 * mangled.
 */
function normalizeRefusal(text: string): string {
  const cleaned = text.trim()
  if (cleaned.length > 200) return text
  if (!REFUSAL_PATTERN.test(cleaned)) return text
  return REFUSAL_CANONICAL
}

export async function sendMessage(args: SendArgs): Promise<ChatMessage> {
  const message = (args.message ?? '').trim()
  if (!message) throw new Error('빈 메시지는 보낼 수 없습니다.')

  // Resolve scope eagerly — if the user picked a meeting that no longer
  // exists, drop it so we don't choke later.
  const validIds = (args.meetingIds ?? []).filter((id) => !!getMeeting(id))

  const history = getChatHistory()
  const userMsg: ChatMessage = {
    role: 'user',
    content: message,
    ts: Date.now(),
    meetingIds: validIds.length > 0 ? validIds : null
  }
  history.push(userMsg)
  persistHistory(history)
  broadcast('chat:update', { history: history.slice() })

  const { session } = await getOrCreateSession(validIds.length > 0 ? validIds : null)

  let assistant = ''
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: '',
    ts: Date.now()
  }
  history.push(assistantMsg)

  try {
    await session.promptWithMeta(message, {
      maxTokens: 1024,
      onTextChunk: (chunk: string) => {
        assistant += chunk
        assistantMsg.content = assistant
        broadcast('chat:token', { content: assistant, done: false })
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    assistantMsg.content = `생성에 실패했습니다: ${msg}`
  }

  // Snap refusal-like answers to the fixed canonical sentence.
  assistantMsg.content = normalizeRefusal(assistantMsg.content)

  persistHistory(history)
  broadcast('chat:token', { content: assistantMsg.content, done: true })
  broadcast('chat:update', { history: history.slice() })
  return assistantMsg
}
