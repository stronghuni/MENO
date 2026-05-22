import type { TranscriptSegment } from '../../shared/types'

function formatTimestamp(s: number): string {
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0')
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, '0')
  return `${mm}:${ss}`
}

function formatTranscript(segments: TranscriptSegment[]): string {
  // No diarization → segments carry no speaker. Emit `[mm:ss] text`
  // without any speaker label so the model never sees (and never
  // invents) "SPK1/SPK2" tags. When a label does exist (future), include it.
  return segments
    .map((s) =>
      s.speaker
        ? `[${formatTimestamp(s.start)}] ${s.speaker}: ${s.text}`
        : `[${formatTimestamp(s.start)}] ${s.text}`
    )
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────
//  Meeting-minutes prompts
//
//  Template synthesizes practices from operators who built strong
//  meeting cultures:
//    • Bezos 6-pager — TL;DR/executive summary at the top so a busy
//      reader gets the gist in 30 seconds.
//    • Andy Grove (High Output Management) — "minutes capture
//      decisions, not discussion." Every decision must have an owner
//      and a rationale.
//    • McKinsey/BCG memo style — structured sections, no prose dumps.
//    • Atlassian / Stripe culture — log dissent and parking-lot
//      items so future readers don't re-debate settled questions.
//    • DRI/RACI — every action item names ONE owner and a date.
//
//  Critical anti-pattern to block: the previous prompt produced
//  "SPK1: ...", "SPK2: ..." bullets that were just the transcript
//  pasted into the notes section. The new prompt explicitly forbids
//  this with a counter-example and demands synthesis by topic.
// ─────────────────────────────────────────────────────────────────────

const MEETING_TEMPLATE = (
  title: string,
  dateStr: string,
  durationStr: string,
  attendeesLine: string
): string => {
  // Keep the 참석자 row always, but leave the value blank when unknown
  // (no "미상"). attendeesLine is '' when there are no attendees.
  return `# ${title}

- **일시**: ${dateStr} (${durationStr})
- **참석자**: ${attendeesLine}
- **회의 목적**: (전사본에서 추론한 한 줄. 모호하면 "정기 논의")

## 한 줄 요약 (TL;DR)
- (이 회의의 가장 중요한 결과를 한 문장으로. 결정이 있으면 결정을, 없으면 진전 사항을.)

## 주요 안건
- (이 회의에서 다룬 핵심 주제 3~5개. 각 안건은 짧은 명사구.)

## 논의 핵심
(여기는 전사본을 옮기는 자리가 아닙니다. 안건별로 묶어서 종합한 분석을 적습니다.)

### {안건명}
- **쟁점**: 이 안건의 핵심 질문이나 결정 포인트 한 문장
- **논의 요지**: 어떤 의견·근거가 오갔는지 종합 (2~4줄). 전사본에 실명이 명시된 경우만 그 이름을 쓰고, 아니면 발언자를 특정하지 말 것
- **합의 / 결론**: 이 안건에서 어디까지 진전됐는지 (합의됐으면 결정 사항에 다시 적기)

(각 안건마다 위 블록을 반복)

## 결정 사항
| # | 결정 | 이유 / 근거 | 반대·우려 의견 | 번복 난이도 |
|---|------|------------|---------------|------------|
| 1 | (한 문장) | (왜 이렇게 결정했는지) | (있으면, 없으면 "없음") | 쉬움/보통/어려움 |

(결정이 없으면 표 헤더 아래에 "이번 회의에서 확정된 결정 사항은 없습니다."라고 한 줄)

## 액션 아이템
| 담당 | 할 일 | 기한 | 우선순위 |
|------|------|-----|---------|
| (담당자 이름. 전사본에서 분명하지 않으면 "미정") | (구체적 동사로 시작) | (YYYY-MM-DD 또는 "다음 회의 전") | 높음/보통/낮음 |

(없으면 "없음"이라고 한 줄)

## 다음 단계 (Next Steps)
- (회의가 끝나고 팀 단위로 무엇을 다음에 하는가. 다음 회의 일정/조건, 결과 공유 방법, 후속 의사결정 트리거 등)

## 미해결 / 다음 논의로 이월
- (결론을 내지 못해 다음 회의/다음 단계에서 다뤄야 할 질문이나 안건)

## 리스크 / 우려사항
- (회의에서 명시적으로 언급된 위험만. 없으면 "언급된 리스크 없음")

<!-- TAGS: 키워드1, 키워드2, 키워드3 -->`
}

const COMMON_RULES = `규칙 (반드시 지킬 것):
1. 한국어 존댓말로 작성하세요.
2. **절대로 전사본을 그대로 옮겨 적지 마세요.** 회의록은 안건별로 묶어 종합한 결과물입니다.
   - ❌ 잘못된 예: "- 그러면 다음주에 합시다."
   - ✅ 올바른 예: "- 일정을 다음주로 미루기로 합의"
3. 회의에 등장하지 않은 내용을 만들어내지 마세요. 추측은 금지입니다.
4. 명확히 합의되지 않은 사항은 "결정 사항"이 아닌 "논의 핵심" 또는 "미해결" 칸으로.
5. 짧은 발언 ("맞아요", "네", "야" 등 추임새)은 회의록에서 빼고 의미 있는 내용만 종합하세요.
6. **이 전사본에는 화자 구분이 없습니다.** SPK1/SPK2 같은 화자 라벨을 절대 만들어내지 마세요. 참석자는 위 헤더의 "참석자" 줄에 주어진 명단만 사용하고, 명단이 비어 있으면 "참석자:" 줄은 그대로 두되 값을 비워두세요("미상" 같은 표기 금지). 전사본에 실명이 직접 등장하지 않는 한 특정 발언을 누구에게 귀속시키지 마세요.
7. 빈 섹션이라도 헤더는 유지하고 "없음" 또는 "언급되지 않음"으로 명시하세요.
8. 마지막 \`<!-- TAGS: ... -->\` 주석에 회의를 대표하는 한국어 명사 3~5개를 쉼표로 (예: 제품, 로드맵, 마케팅).
9. 회의록 마크다운만 출력하세요. 설명·인사·코드블록 금지.
10. **전사 내용이 인사말·잡담뿐이거나 의미 있는 논의가 없으면, 각 섹션을 "논의된 내용 없음"으로 채우고 절대 가짜 안건·참석자·결정을 지어내지 마세요.**`

export function buildMeetingNotesPrompt(
  title: string,
  startedAt: number,
  durationMs: number | null,
  segments: TranscriptSegment[],
  attendees: string[] = []
): string {
  const date = new Date(startedAt)
  const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  const durationStr = durationMs
    ? `${Math.floor(durationMs / 60000)}분 ${Math.floor((durationMs % 60000) / 1000)}초`
    : '—'
  const attendeesLine = attendees.length > 0 ? attendees.join(', ') : ''

  return `당신은 회의 전사본을 분석해 임원 보고용 회의록을 작성하는 전문 회의 서기입니다.
당신의 회의록은 회의에 참석하지 못한 사람이 30초 안에 핵심을 파악할 수 있어야 합니다.

다음 전사본을 분석해서 아래 형식의 마크다운 회의록을 작성하세요.
${attendeesLine ? '"참석자" 줄은 아래 주어진 명단을 그대로 사용하고 임의로 바꾸지 마세요.' : '"참석자" 줄은 그대로 두되 값은 비워두세요. "미상" 같은 텍스트를 넣지 마세요.'}

${MEETING_TEMPLATE(title, dateStr, durationStr, attendeesLine)}

${COMMON_RULES}

전사본:
${formatTranscript(segments)}
`
}

/**
 * Pull the `<!-- TAGS: ... -->` line out of an LLM-generated note. Returns
 * empty array if the comment is missing or malformed. The comment itself is
 * stripped from the notes before persisting.
 */
export function extractTags(notesMd: string): { tags: string[]; cleanedNotes: string } {
  const re = /<!--\s*TAGS:\s*([^>]+?)\s*-->/i
  const match = notesMd.match(re)
  if (!match) return { tags: [], cleanedNotes: notesMd }
  const tags = match[1]
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 24)
    .slice(0, 5)
  const cleanedNotes = notesMd.replace(re, '').trimEnd()
  return { tags, cleanedNotes }
}

/**
 * Deterministically force the "참석자" line to the form-provided attendee
 * list (blank when none). The single-pass prompt obeys this, but the
 * long-meeting map-reduce path occasionally lets the model write "미상" or
 * invent names despite the rule — so we rewrite the line after generation
 * regardless of which path produced the notes.
 */
export function enforceAttendeesLine(notesMd: string, attendees: string[]): string {
  const value = attendees.length > 0 ? attendees.join(', ') : ''
  return notesMd.replace(/^(\s*[-*]\s*\*\*참석자\*\*\s*:).*$/m, (_m, prefix: string) =>
    value ? `${prefix} ${value}` : prefix
  )
}

export interface ExtractedKeywords {
  tags: string[]
  attendees: string[]
}

/** Naive client-side fallback: extract unique speaker labels as attendees. */
export function extractAttendees(segments: TranscriptSegment[]): string[] {
  const set = new Set<string>()
  for (const s of segments) if (s.speaker) set.add(s.speaker)
  return Array.from(set)
}

/**
 * For long meetings we map-reduce: ask the LLM to extract structured
 * bullet points from each time window, then ask once more for a final
 * synthesis. The per-chunk prompt is deliberately narrow so each call
 * stays under a few thousand tokens.
 */
export function buildChunkSummaryPrompt(
  segments: TranscriptSegment[],
  chunkIndex: number,
  totalChunks: number,
  chunkStartSec: number,
  chunkEndSec: number
): string {
  const startMin = Math.floor(chunkStartSec / 60)
  const endMin = Math.ceil(chunkEndSec / 60)
  return `당신은 회의 전사본의 한 구간을 분석해 핵심 정보를 추출하는 회의 서기입니다.

다음은 전체 회의 중 ${chunkIndex + 1}/${totalChunks} 구간 (${startMin}~${endMin}분) 전사본입니다.
이 구간에서만 명확하게 등장한 내용을 아래 형식의 마크다운으로 정리하세요. 등장하지 않은 항목은 비워두세요.

### 안건 (이 구간에서 다룬 주제)
- 안건명 / 핵심 질문 한 줄

### 논의 핵심
- **(안건명)**: 쟁점은 무엇이고 어떤 의견·근거가 오갔는지 1~2줄로 종합. 합의 방향: (합의 내용 또는 "미합의")

### 결정
- 명시적으로 결정·합의된 사항만 (없으면 "없음")

### 액션 아이템
- (담당자, 불분명하면 "미정"): (구체적 동사로 시작) (기한 있으면 YYYY-MM-DD 또는 "다음 회의 전")

### 미해결 / 이월
- 결론 안 난 안건이나 추가 정보 필요한 질문

### 리스크
- 회의에서 명시적으로 언급된 위험만

규칙:
1. 한국어 존댓말, 짧고 명확한 불릿
2. **전사본 발언을 그대로 옮기지 마세요.** 안건별로 종합·정리합니다.
3. **이 전사본에는 화자 구분이 없습니다.** SPK1·화자A·화자B 같은 화자 라벨을 절대 만들어내지 말고, 전사본에 실명이 직접 등장하지 않는 한 특정 발언을 누구에게 귀속시키지 마세요.
4. 추임새, 짧은 응답("맞아요", "네") 등은 무시
5. 이 구간에 명시되지 않은 내용을 만들어내지 마세요
6. 위 마크다운만 출력하세요

전사본:
${formatTranscript(segments)}
`
}

/**
 * Final merge: combine per-chunk extracts into the full standard meeting
 * note. The LLM sees only the bullet outputs from the previous step, so
 * the prompt stays small even for multi-hour recordings.
 */
export function buildMergePrompt(
  title: string,
  startedAt: number,
  durationMs: number | null,
  attendees: string[],
  chunkSummaries: string[]
): string {
  const date = new Date(startedAt)
  const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  const durationStr = durationMs
    ? `${Math.floor(durationMs / 60000)}분 ${Math.floor((durationMs % 60000) / 1000)}초`
    : '—'
  const attendeesStr = attendees.length > 0 ? attendees.join(', ') : ''
  const numbered = chunkSummaries.map((s, i) => `## 구간 ${i + 1}\n${s.trim()}`).join('\n\n')

  return `당신은 회의 구간별 요약을 통합해 임원 보고용 최종 회의록을 작성하는 전문 회의 서기입니다.

다음은 각 구간 (10분 단위)에서 추출한 핵심 정보입니다:

${numbered}

위 구간별 정보를 통합해서 아래 형식의 마크다운 회의록을 작성하세요. 같은 안건이 여러 구간에 흩어져 있으면 한 항목으로 묶고, 후반부 결정이 전반부 논의를 뒤집었으면 그 흐름이 드러나도록 정리하세요.

${MEETING_TEMPLATE(title, dateStr, durationStr, attendeesStr)}

${COMMON_RULES}

추가 통합 규칙:
- 구간 요약에 없는 내용을 만들어내지 마세요.
- 같은 안건이 여러 구간에 나오면 한 블록으로 통합하세요.
- 결정 사항은 마지막에 합의된 버전을 채택하세요 (번복된 경우 "번복 난이도"에 그 사실 기록).
`
}

/**
 * Split a transcript into time-bound chunks for map-reduce summarization.
 * Each chunk gets an overlap region so context isn't lost at boundaries.
 */
export function chunkSegmentsByTime(
  segments: TranscriptSegment[],
  chunkSec: number,
  overlapSec: number
): { segments: TranscriptSegment[]; startSec: number; endSec: number }[] {
  if (segments.length === 0) return []
  const totalEnd = segments[segments.length - 1].end
  const chunks: { segments: TranscriptSegment[]; startSec: number; endSec: number }[] = []
  let start = 0
  while (start < totalEnd) {
    const end = Math.min(start + chunkSec, totalEnd)
    const chunkSegments = segments.filter((s) => s.end > start && s.start < end)
    if (chunkSegments.length > 0) {
      chunks.push({ segments: chunkSegments, startSec: start, endSec: end })
    }
    if (end >= totalEnd) break
    start = end - overlapSec
  }
  return chunks
}
