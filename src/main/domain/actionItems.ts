/**
 * Parse the "## 액션 아이템" markdown table out of a generated meeting note.
 * The summarizer emits:
 *
 *   ## 액션 아이템
 *   | 담당 | 할 일 | 기한 | 우선순위 |
 *   |------|------|-----|---------|
 *   | 김정훈 | 로드맵 정리 | 2026-05-25 | 높음 |
 *
 * Returns one entry per real row. Header, divider, and "없음" placeholder
 * rows are dropped. Pure + dependency-free so it's unit-testable and can
 * be reused by the Jira exporter without touching Electron.
 */

export interface ActionItem {
  assignee: string // raw Korean name or "미정" / ""
  task: string
  due: string // raw cell ("2026-05-25", "다음 회의 전", "")
  priority: string // raw cell ("높음" / "보통" / "낮음" / "")
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

export function parseActionItems(notesMd: string | null): ActionItem[] {
  if (!notesMd) return []
  const lines = notesMd.replace(/\r\n/g, '\n').split('\n')

  // Find the "액션 아이템" heading (any heading level).
  let i = lines.findIndex((l) => /^#{1,6}\s+.*액션\s*아이템/.test(l.trim()))
  if (i === -1) return []
  i++ // move past the heading

  // Skip blank lines until the table starts.
  while (i < lines.length && lines[i].trim() === '') i++

  const items: ActionItem[] = []
  let sawHeader = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (/^#{1,6}\s+/.test(line.trim())) break // next section
    if (!isTableRow(line)) break // table ended
    if (isDivider(line)) continue
    const cells = splitCells(line)
    // First non-divider row is the header (담당 | 할 일 | 기한 | 우선순위).
    if (!sawHeader) {
      sawHeader = true
      continue
    }
    const [assignee = '', task = '', due = '', priority = ''] = cells
    const taskTrim = task.trim()
    // Drop empty rows and "없음" placeholders.
    if (!taskTrim || taskTrim === '없음' || /^없\s*음$/.test(taskTrim)) continue
    items.push({
      assignee: assignee.trim(),
      task: taskTrim,
      due: due.trim(),
      priority: priority.trim()
    })
  }
  return items
}

/** Map the Korean priority cell to a Jira priority name. Returns null when
 *  unmappable so the caller can omit the field (instances differ). */
export function mapPriority(korean: string): string | null {
  const p = korean.trim()
  if (/긴급|최우선|highest/i.test(p)) return 'Highest'
  if (/높|상|high/i.test(p)) return 'High'
  if (/보통|중|medium|normal/i.test(p)) return 'Medium'
  if (/낮|하|low/i.test(p)) return 'Low'
  return null
}

/** Accept only an ISO date (YYYY-MM-DD); anything else ("다음 회의 전") → null. */
export function normalizeDueDate(raw: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
