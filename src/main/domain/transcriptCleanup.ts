import type { TranscriptSegment } from '../../shared/types'

/**
 * Collapses runs of identical-text Whisper segments down to one. The
 * silence-loop hallucination pattern looks like 8× "안녕하세요." emitted at
 * fixed ~2 s intervals across an otherwise-empty recording — same text,
 * consecutive, short, with small inter-segment gaps. Energy-gate VAD won't
 * always catch it (if the mic has any constant noise above the floor, the
 * filter passes), but the text-level signature is unmistakable: keep the
 * first occurrence, drop the rest.
 *
 * Heuristic:
 *   - Group consecutive segments whose trimmed text is identical and whose
 *     inter-segment gap ≤ `maxGapSec`.
 *   - If the group is at least `runThreshold` long AND each line is short
 *     (≤ `maxLineLen`), treat it as a Whisper loop and keep only the first.
 *   - Otherwise (legit repeated phrasing or long shared sentences) keep all.
 */

export interface CollapseOptions {
  /** Largest accepted gap between segments to still consider them "consecutive". */
  maxGapSec: number
  /** Minimum group size that flags a loop. ≥3 catches the common pattern. */
  runThreshold: number
  /** Hallucination loops are short canned phrases. Refuse to collapse long ones. */
  maxLineLen: number
}

const DEFAULTS: CollapseOptions = {
  maxGapSec: 6,
  runThreshold: 3,
  // Common Whisper Korean hallucinations all fit comfortably in 25 chars
  // ("안녕하세요.", "감사합니다.", "시청해주셔서 감사합니다.", "MBC 뉴스 OOO입니다."
  //  etc). A real repeated meeting sentence is almost always longer.
  maxLineLen: 25
}

export function collapseRepeatedSegments(
  segments: TranscriptSegment[],
  opts: Partial<CollapseOptions> = {}
): TranscriptSegment[] {
  const cfg = { ...DEFAULTS, ...opts }
  if (segments.length === 0) return segments
  const result: TranscriptSegment[] = []
  let i = 0
  while (i < segments.length) {
    const start = i
    const startText = segments[i].text.trim()
    // Walk forward while text identical and the gap stays small.
    while (
      i + 1 < segments.length &&
      segments[i + 1].text.trim() === startText &&
      segments[i + 1].start - segments[i].end <= cfg.maxGapSec
    ) {
      i++
    }
    const runLen = i - start + 1
    const isLoop = runLen >= cfg.runThreshold && startText.length <= cfg.maxLineLen
    if (isLoop) {
      result.push(segments[start])
    } else {
      for (let j = start; j <= i; j++) result.push(segments[j])
    }
    i++
  }
  return result
}
