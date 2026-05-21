import { describe, expect, it } from 'vitest'
import { mergeTranscriptWithDiarization } from './merger'

describe('mergeTranscriptWithDiarization', () => {
  it('labels each transcript segment with the speaker with the largest overlap', () => {
    const transcript = [
      { start: 0, end: 2, speaker: null, text: '안녕하세요' },
      { start: 2.1, end: 4, speaker: null, text: '네 반갑습니다' }
    ]
    const diarization = [
      { start: 0, end: 2.05, speaker: 0 },
      { start: 2.05, end: 4.5, speaker: 1 }
    ]
    const out = mergeTranscriptWithDiarization(transcript, diarization)
    expect(out[0].speaker).toBe('SPK1')
    expect(out[1].speaker).toBe('SPK2')
  })

  it('leaves speaker null when no diarization overlaps', () => {
    const out = mergeTranscriptWithDiarization(
      [{ start: 10, end: 11, speaker: null, text: '구간 외' }],
      [
        { start: 0, end: 2, speaker: 0 },
        { start: 2, end: 4, speaker: 1 }
      ]
    )
    expect(out[0].speaker).toBeNull()
  })

  it('picks the speaker whose overlap is largest even when multiple cross the boundary', () => {
    const out = mergeTranscriptWithDiarization(
      [{ start: 5, end: 10, speaker: null, text: '걸치는 구간' }],
      [
        { start: 4, end: 6.0, speaker: 0 },
        { start: 6.0, end: 12, speaker: 2 }
      ]
    )
    // 1s overlap with speaker 0, 4s overlap with speaker 2.
    expect(out[0].speaker).toBe('SPK3')
  })

  it('preserves text and timestamps untouched', () => {
    const transcript = [{ start: 1.5, end: 3.2, speaker: null, text: '원문' }]
    const out = mergeTranscriptWithDiarization(transcript, [
      { start: 1, end: 4, speaker: 0 }
    ])
    expect(out[0].text).toBe('원문')
    expect(out[0].start).toBe(1.5)
    expect(out[0].end).toBe(3.2)
  })

  it('returns an empty array for empty input', () => {
    expect(mergeTranscriptWithDiarization([], [])).toEqual([])
  })
})
