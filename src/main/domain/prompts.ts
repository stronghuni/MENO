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
  return segments
    .map((s) => {
      const speaker = s.speaker ?? '미상'
      return `[${formatTimestamp(s.start)}] ${speaker}: ${s.text}`
    })
    .join('\n')
}

export function buildMeetingNotesPrompt(
  title: string,
  startedAt: number,
  durationMs: number | null,
  segments: TranscriptSegment[]
): string {
  const date = new Date(startedAt)
  const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  const durationStr = durationMs
    ? `${Math.floor(durationMs / 60000)}분 ${Math.floor((durationMs % 60000) / 1000)}초`
    : '—'

  return `당신은 회의 전사본을 분석해 깔끔한 한국어 회의록을 작성하는 보조원입니다.

다음 전사본을 분석해서 아래 형식의 마크다운 회의록을 작성하세요. 항목이 비어 있더라도 헤더는 유지하세요.

# ${title}

- **일시**: ${dateStr} (${durationStr})
- **참석자**: 전사본에서 등장한 화자 (SPK1, SPK2 등 그대로 사용하거나 호칭으로 통합)

## 주요 안건
- (회의에서 다룬 핵심 주제 3~5개를 짧은 불릿으로)

## 논의 내용
- (각 안건에 대한 논의 흐름을 항목별로 정리, 화자 의견 차이가 있다면 명시)

## 결정 사항
- (회의에서 합의되거나 결정된 사항)

## 액션 아이템
| 담당 | 내용 | 기한 |
|------|------|------|
| (담당자) | (할 일) | (기한) |

<!-- TAGS: 키워드1, 키워드2, 키워드3 -->

규칙:
1. 한국어 존댓말로 작성합니다.
2. 회의에 등장하지 않은 내용을 만들어내지 마세요. 명확히 합의되지 않은 사항은 결정사항이 아닌 논의 내용에 두세요.
3. 액션 아이템이 없으면 표는 그대로 두고 본문에 "없음"이라고 적으세요.
4. 짧고 명확한 불릿으로 작성하세요. 한 불릿은 한 문장이 좋습니다.
5. 마지막 줄의 \`<!-- TAGS: ... -->\` 주석에는 회의를 대표하는 한국어 명사 3~5개를 쉼표로 구분해 넣으세요. (예: 제품, 로드맵, 마케팅)
6. 회의록 마크다운만 출력하고 다른 설명은 붙이지 마세요.

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
  return `당신은 회의 전사본의 한 구간을 분석해 핵심 정보를 추출하는 보조원입니다.

다음은 전체 회의 중 ${chunkIndex + 1}/${totalChunks} 구간 (${startMin}~${endMin}분) 전사본입니다.
이 구간에서만 명확하게 등장한 내용을 아래 형식의 마크다운으로 정리하세요. 등장하지 않은 항목은 비워두세요.

### 안건
- (이 구간에서 다룬 주제 짧은 불릿)

### 논의
- (논의 흐름, 화자 의견 차이 포함)

### 결정
- (명확하게 합의된 사항만)

### 액션
- {담당}: {내용} (기한 있으면 표기)

규칙:
1. 한국어 존댓말, 짧고 명확한 불릿
2. 이 구간에 명시되지 않은 내용을 만들어내지 마세요
3. 위 마크다운만 출력하세요

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
  const attendeesStr = attendees.length > 0 ? attendees.join(', ') : '미상'
  const numbered = chunkSummaries.map((s, i) => `## 구간 ${i + 1}\n${s.trim()}`).join('\n\n')

  return `당신은 회의 전사본 구간별 요약을 통합해 최종 회의록을 작성하는 보조원입니다.

다음은 각 구간 (10분 단위)에서 추출한 핵심 정보입니다:

${numbered}

위 구간별 정보를 통합해서 아래 형식의 마크다운 회의록을 작성하세요. 헤더는 비어 있더라도 유지하세요.

# ${title}

- **일시**: ${dateStr} (${durationStr})
- **참석자**: ${attendeesStr}

## 주요 안건
- (전체 회의에서 다룬 핵심 주제 3~6개)

## 논의 내용
- (구간별로 흩어진 논의를 주제별로 묶어 정리)

## 결정 사항
- (회의에서 합의되거나 결정된 사항)

## 액션 아이템
| 담당 | 내용 | 기한 |
|------|------|------|
| (담당자) | (할 일) | (기한) |

<!-- TAGS: 키워드1, 키워드2, 키워드3 -->

규칙:
1. 한국어 존댓말로 작성
2. 구간 요약에 없는 내용을 만들어내지 마세요
3. 액션 아이템이 없으면 "없음"이라고 적으세요
4. 마지막 \`<!-- TAGS: ... -->\` 주석에 회의를 대표하는 명사 3~5개를 쉼표로 구분해 넣으세요
5. 최종 회의록 마크다운만 출력
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
