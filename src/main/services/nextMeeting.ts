import { getLlama, getModel, isLlmInstalled } from './summarizer'

/**
 * Extract a concrete "next meeting" date/time from a meeting's notes.
 * Korean meetings often end with relative dates ("다음 주 화요일 3시"), so we
 * give the model the meeting's own date and ask it to resolve to an absolute
 * timestamp. JSON-schema-constrained; returns null on anything uncertain so
 * we never create junk calendar entries from a vague mention.
 */

const SCHEMA = {
  type: 'object',
  properties: {
    hasNext: { type: 'boolean' },
    isoDateTime: { type: 'string' },
    title: { type: 'string' }
  },
  required: ['hasNext', 'isoDateTime', 'title']
} as const

export interface NextMeeting {
  scheduledAt: number
  title: string
}

export async function extractNextMeeting(
  notesMd: string,
  meetingDate: Date,
  meetingTitle: string
): Promise<NextMeeting | null> {
  if (!isLlmInstalled() || !notesMd.trim()) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llama = (await getLlama()) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (await getModel()) as any
    const { LlamaChatSession } = await import('node-llama-cpp')
    const grammar = await llama.createGrammarForJsonSchema(SCHEMA)
    const context = await model.createContext({ contextSize: 4096 })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = new (LlamaChatSession as any)({ contextSequence: context.getSequence() })
      const baseIso = meetingDate.toISOString()
      const prompt = `이 회의는 ${baseIso} 에 진행됐습니다. 아래 회의록에서 **다음 회의(후속 미팅) 일정**이 구체적으로 정해졌는지 찾으세요.
- 명확한 날짜/시간이 있으면(상대 표현이면 위 회의 날짜 기준으로 절대 시각 계산) hasNext=true, isoDateTime=ISO8601(예: 2026-06-03T15:00:00), title=다음 회의 제목(없으면 "${meetingTitle} 후속 회의").
- 다음 회의 일정이 없거나 "추후 공지" 같이 불명확하면 hasNext=false, isoDateTime="", title="".
- 추측하지 마세요. 구체적 일정이 명시된 경우만 true.

회의록:
${notesMd.slice(0, 6000)}`
      const raw = await session.prompt(prompt, { grammar, maxTokens: 200 })
      const parsed = grammar.parse(raw) as { hasNext?: boolean; isoDateTime?: string; title?: string }
      if (!parsed.hasNext || !parsed.isoDateTime) return null
      const ts = Date.parse(parsed.isoDateTime)
      if (Number.isNaN(ts)) return null
      // Only accept a future time after the meeting (reject past/garbage).
      if (ts <= meetingDate.getTime()) return null
      const title = (parsed.title || `${meetingTitle} 후속 회의`).slice(0, 120)
      return { scheduledAt: ts, title }
    } finally {
      context.dispose()
    }
  } catch (e) {
    console.warn('[nextMeeting] extraction failed:', e)
    return null
  }
}
