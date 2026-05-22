import { describe, it, expect } from 'vitest'
import { parseActionItems, mapPriority, normalizeDueDate } from './actionItems'

const NOTES = `# 제품 로드맵 회의

- **일시**: 2026-05-22 (41분)

## 액션 아이템
| 담당 | 할 일 | 기한 | 우선순위 |
|------|------|-----|---------|
| 김정훈 | 로드맵 문서 정리 | 2026-05-25 | 높음 |
| 이서연 | QA 일정 확인 | 다음 회의 전 | 보통 |

## 다음 단계
- 후속 회의 일정 잡기
`

describe('parseActionItems', () => {
  it('extracts rows, skipping header + divider + later sections', () => {
    const items = parseActionItems(NOTES)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      assignee: '김정훈',
      task: '로드맵 문서 정리',
      due: '2026-05-25',
      priority: '높음'
    })
    expect(items[1].task).toBe('QA 일정 확인')
  })

  it('returns [] when no action-item section', () => {
    expect(parseActionItems('# 회의\n\n## 주요 안건\n- 항목')).toEqual([])
  })

  it('drops "없음" placeholder rows', () => {
    const md = `## 액션 아이템
| 담당 | 할 일 | 기한 | 우선순위 |
|------|------|-----|---------|
| 없음 | 없음 | 없음 | 없음 |`
    expect(parseActionItems(md)).toEqual([])
  })

  it('handles null / empty input', () => {
    expect(parseActionItems(null)).toEqual([])
    expect(parseActionItems('')).toEqual([])
  })
})

describe('mapPriority', () => {
  it('maps Korean priorities', () => {
    expect(mapPriority('높음')).toBe('High')
    expect(mapPriority('보통')).toBe('Medium')
    expect(mapPriority('낮음')).toBe('Low')
    expect(mapPriority('긴급')).toBe('Highest')
  })
  it('returns null for unmappable', () => {
    expect(mapPriority('')).toBeNull()
    expect(mapPriority('아무거나')).toBeNull()
  })
})

describe('normalizeDueDate', () => {
  it('accepts ISO dates only', () => {
    expect(normalizeDueDate('2026-05-25')).toBe('2026-05-25')
    expect(normalizeDueDate('기한: 2026-05-25 까지')).toBe('2026-05-25')
  })
  it('rejects non-ISO', () => {
    expect(normalizeDueDate('다음 회의 전')).toBeNull()
    expect(normalizeDueDate('')).toBeNull()
  })
})
