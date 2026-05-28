import { describe, it, expect } from 'vitest'
import { collapseRepeatedSegments } from './transcriptCleanup'
import type { TranscriptSegment } from '../../shared/types'

function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, speaker: null, text }
}

describe('collapseRepeatedSegments', () => {
  it('keeps the first occurrence when 3+ identical short segments repeat', () => {
    const input = [
      seg(0, 2, '안녕하세요.'),
      seg(2, 4, '안녕하세요.'),
      seg(4, 6, '안녕하세요.'),
      seg(6, 8, '안녕하세요.')
    ]
    const out = collapseRepeatedSegments(input)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(input[0])
  })

  it('leaves 2 identical segments alone (not a loop)', () => {
    const input = [seg(0, 2, '네.'), seg(2, 4, '네.')]
    expect(collapseRepeatedSegments(input)).toEqual(input)
  })

  it('does not collapse identical segments if the gap is too large', () => {
    // 3 identical lines but 30s apart — not a loop, distinct utterances.
    const input = [seg(0, 2, '네.'), seg(32, 34, '네.'), seg(64, 66, '네.')]
    expect(collapseRepeatedSegments(input)).toEqual(input)
  })

  it('does not collapse long lines (loops are always short canned phrases)', () => {
    const long = '오늘 회의에서는 다음 주의 출시 일정과 마케팅 계획에 대해 논의했습니다.'
    const input = [seg(0, 5, long), seg(5, 10, long), seg(10, 15, long)]
    expect(collapseRepeatedSegments(input)).toEqual(input)
  })

  it('preserves segments between loops', () => {
    const input = [
      seg(0, 2, '안녕하세요.'),
      seg(2, 4, '안녕하세요.'),
      seg(4, 6, '안녕하세요.'),
      seg(7, 9, '회의 시작하겠습니다.'),
      seg(10, 12, '감사합니다.'),
      seg(12, 14, '감사합니다.'),
      seg(14, 16, '감사합니다.')
    ]
    const out = collapseRepeatedSegments(input)
    expect(out.map((s) => s.text)).toEqual([
      '안녕하세요.',
      '회의 시작하겠습니다.',
      '감사합니다.'
    ])
  })

  it('handles empty + single-segment input', () => {
    expect(collapseRepeatedSegments([])).toEqual([])
    const one = [seg(0, 2, '안녕하세요.')]
    expect(collapseRepeatedSegments(one)).toEqual(one)
  })

  it('normalizes leading/trailing whitespace when matching', () => {
    // Whisper sometimes nudges spacing across loop repeats. trim() should
    // collapse these into one.
    const input = [
      seg(0, 2, ' 안녕하세요.'),
      seg(2, 4, '안녕하세요.'),
      seg(4, 6, '안녕하세요. ')
    ]
    expect(collapseRepeatedSegments(input)).toHaveLength(1)
  })
})
