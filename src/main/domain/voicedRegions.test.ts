import { describe, it, expect } from 'vitest'
import { computeVoicedRegions, overlapVoicedSec } from './voicedRegions'

const SR = 16000

/** Pure silence (all zeros). */
function silence(ms: number): Float32Array {
  return new Float32Array(Math.floor((ms / 1000) * SR))
}

/** Steady tone — louder than the noise floor by ~30 dB at amp 0.3. */
function tone(ms: number, freq = 200, amp = 0.3): Float32Array {
  const n = Math.floor((ms / 1000) * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}

function concat(...arrs: Float32Array[]): Float32Array {
  const total = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

describe('computeVoicedRegions', () => {
  it('returns no regions for pure silence', () => {
    expect(computeVoicedRegions(silence(2000))).toEqual([])
  })

  it('returns one region covering the full duration of a steady tone', () => {
    const regions = computeVoicedRegions(tone(2000))
    expect(regions.length).toBe(1)
    expect(regions[0].startSec).toBeLessThan(0.1)
    expect(regions[0].endSec).toBeGreaterThan(1.9)
  })

  it('returns no regions for a too-short voiced burst', () => {
    // 50 ms tone surrounded by silence — below default minVoicedMs (200).
    const pcm = concat(silence(500), tone(50), silence(500))
    expect(computeVoicedRegions(pcm)).toEqual([])
  })

  it('merges two voiced spans separated by a short gap (≤ maxGapMs)', () => {
    // 200 ms gap between two 500 ms tones — gap ≤ 300 ms → one merged region.
    const pcm = concat(tone(500), silence(200), tone(500))
    const regions = computeVoicedRegions(pcm)
    expect(regions.length).toBe(1)
    expect(regions[0].endSec - regions[0].startSec).toBeGreaterThan(1.0)
  })

  it('keeps two separate regions when the gap is longer than maxGapMs', () => {
    // 800 ms gap > 300 ms maxGap → not merged.
    const pcm = concat(tone(500), silence(800), tone(500))
    const regions = computeVoicedRegions(pcm)
    expect(regions.length).toBe(2)
    // Second region starts after the gap.
    expect(regions[1].startSec).toBeGreaterThan(1.0)
  })

  it('handles PCM shorter than one frame', () => {
    // 10 ms @ 16 kHz = 160 samples, less than 480-sample (30 ms) frame.
    expect(computeVoicedRegions(tone(10))).toEqual([])
  })
})

describe('overlapVoicedSec', () => {
  const voiced = [
    { startSec: 1.0, endSec: 2.0 },
    { startSec: 3.5, endSec: 4.0 }
  ]

  it('returns 0 when the segment falls entirely in silence', () => {
    expect(overlapVoicedSec(2.2, 3.4, voiced)).toBe(0)
  })

  it('returns full segment duration when contained inside a region', () => {
    expect(overlapVoicedSec(1.2, 1.8, voiced)).toBeCloseTo(0.6)
  })

  it('sums overlap across multiple regions', () => {
    // 1.5..3.8 overlaps [1.5..2.0] (0.5) + [3.5..3.8] (0.3) = 0.8
    expect(overlapVoicedSec(1.5, 3.8, voiced)).toBeCloseTo(0.8)
  })

  it('returns 0 for an empty segment', () => {
    expect(overlapVoicedSec(1.5, 1.5, voiced)).toBe(0)
    expect(overlapVoicedSec(2.0, 1.0, voiced)).toBe(0)
  })

  it('returns 0 when voiced list is empty', () => {
    expect(overlapVoicedSec(0, 10, [])).toBe(0)
  })
})
