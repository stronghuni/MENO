import { describe, expect, it } from 'vitest'
import {
  buildMeetingNotesPrompt,
  chunkSegmentsByTime,
  extractAttendees,
  extractTags
} from './prompts'

const segments = [
  { start: 0, end: 5, speaker: 'SPK1', text: '안녕하세요, 회의 시작하겠습니다.' },
  { start: 5, end: 10, speaker: 'SPK2', text: '네, 로드맵부터 보겠습니다.' }
]

describe('buildMeetingNotesPrompt', () => {
  it('contains every required section header', () => {
    const prompt = buildMeetingNotesPrompt(
      '제품 회의',
      Date.parse('2026-05-21T10:00:00'),
      3600000,
      segments
    )
    expect(prompt).toContain('## 한 줄 요약')
    expect(prompt).toContain('## 주요 안건')
    expect(prompt).toContain('## 논의 핵심')
    expect(prompt).toContain('## 결정 사항')
    expect(prompt).toContain('## 액션 아이템')
    expect(prompt).toContain('## 다음 단계')
    expect(prompt).toContain('## 미해결')
    expect(prompt).toContain('## 리스크')
    expect(prompt).toContain('<!-- TAGS:')
    // Anti-transcript-copy directive must be present.
    expect(prompt).toContain('전사본을 그대로 옮겨 적지 마세요')
  })

  it('renders the date in YYYY-MM-DD HH:MM format', () => {
    const prompt = buildMeetingNotesPrompt(
      '제품 회의',
      Date.parse('2026-05-21T10:05:00'),
      3600000,
      segments
    )
    expect(prompt).toMatch(/2026-05-21 10:05/)
  })

  it('renders duration in "분 초" format', () => {
    const prompt = buildMeetingNotesPrompt('제품', Date.now(), 65_000, segments)
    expect(prompt).toContain('1분 5초')
  })

  it('includes speaker tags in the formatted transcript', () => {
    const prompt = buildMeetingNotesPrompt('제품', Date.now(), null, segments)
    expect(prompt).toContain('SPK1:')
    expect(prompt).toContain('SPK2:')
  })
})

describe('extractAttendees', () => {
  it('returns unique speakers preserving first-seen order', () => {
    expect(
      extractAttendees([
        { start: 0, end: 1, speaker: 'SPK1', text: 'a' },
        { start: 1, end: 2, speaker: 'SPK2', text: 'b' },
        { start: 2, end: 3, speaker: 'SPK1', text: 'c' }
      ])
    ).toEqual(['SPK1', 'SPK2'])
  })

  it('skips null speakers', () => {
    expect(
      extractAttendees([
        { start: 0, end: 1, speaker: null, text: 'a' },
        { start: 1, end: 2, speaker: 'SPK1', text: 'b' }
      ])
    ).toEqual(['SPK1'])
  })
})

describe('extractTags', () => {
  it('parses comma-separated Korean keywords from the TAGS comment', () => {
    const md = `# 제목\n## 주요 안건\n- ...\n\n<!-- TAGS: 제품, 로드맵, 마케팅 -->`
    const { tags, cleanedNotes } = extractTags(md)
    expect(tags).toEqual(['제품', '로드맵', '마케팅'])
    expect(cleanedNotes).not.toContain('<!-- TAGS:')
  })

  it('returns an empty array when the comment is absent', () => {
    const md = '# 회의\n내용'
    const { tags, cleanedNotes } = extractTags(md)
    expect(tags).toEqual([])
    expect(cleanedNotes).toBe(md)
  })

  it('caps at 5 tags and drops empty strings', () => {
    const md = '# 회의\n<!-- TAGS: a, b,, c, d, e, f, g -->'
    const { tags } = extractTags(md)
    expect(tags).toHaveLength(5)
    expect(tags).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('rejects absurdly long tag strings', () => {
    const long = 'a'.repeat(50)
    const md = `# 회의\n<!-- TAGS: 정상, ${long}, 짧음 -->`
    const { tags } = extractTags(md)
    expect(tags).toEqual(['정상', '짧음'])
  })

  it('handles fullwidth comma (，) used in some Korean input methods', () => {
    const md = '# 회의\n<!-- TAGS: 제품，로드맵，마케팅 -->'
    const { tags } = extractTags(md)
    expect(tags).toEqual(['제품', '로드맵', '마케팅'])
  })
})

describe('chunkSegmentsByTime', () => {
  const seg = (start: number, end: number) => ({
    start,
    end,
    speaker: null as string | null,
    text: `s${start}`
  })

  it('returns empty array on empty input', () => {
    expect(chunkSegmentsByTime([], 600, 60)).toEqual([])
  })

  it('keeps a short transcript in a single chunk', () => {
    const segs = [seg(0, 30), seg(30, 60), seg(60, 120)]
    const chunks = chunkSegmentsByTime(segs, 600, 60)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].startSec).toBe(0)
    expect(chunks[0].endSec).toBe(120)
    expect(chunks[0].segments).toHaveLength(3)
  })

  it('splits a long transcript into time-bounded chunks with overlap', () => {
    // Build 25 minutes of 30-second segments.
    const segs: ReturnType<typeof seg>[] = []
    for (let t = 0; t < 25 * 60; t += 30) segs.push(seg(t, t + 30))
    const chunks = chunkSegmentsByTime(segs, 10 * 60, 60)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    // First chunk [0, 600]
    expect(chunks[0].startSec).toBe(0)
    expect(chunks[0].endSec).toBe(600)
    // Second chunk starts at 540 (overlap of 60s)
    expect(chunks[1].startSec).toBe(540)
    expect(chunks[1].endSec).toBe(1140)
  })

  it('includes segments that straddle a chunk boundary in both chunks', () => {
    const segs = [seg(580, 620)] // straddles a 600s boundary
    const chunks = chunkSegmentsByTime(
      [...Array.from({ length: 21 }, (_, i) => seg(i * 60, i * 60 + 60)), ...segs],
      10 * 60,
      60
    )
    const straddleInFirst = chunks[0].segments.some((s) => s.start === 580)
    const straddleInSecond = chunks[1]?.segments.some((s) => s.start === 580) ?? false
    expect(straddleInFirst).toBe(true)
    expect(straddleInSecond).toBe(true)
  })
})
