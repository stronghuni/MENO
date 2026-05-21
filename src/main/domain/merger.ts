import type { TranscriptSegment } from '../../shared/types'

export interface DiarizationSegment {
  start: number
  end: number
  speaker: number
}

/**
 * Assign a speaker label to each transcript segment by picking the diarization
 * segment with the largest temporal overlap. If nothing overlaps, leave the
 * speaker as null and the UI will render as "Unknown".
 */
export function mergeTranscriptWithDiarization(
  transcript: TranscriptSegment[],
  diarization: DiarizationSegment[]
): TranscriptSegment[] {
  return transcript.map((seg) => {
    let bestSpeaker: number | null = null
    let bestOverlap = 0
    for (const d of diarization) {
      const overlap = Math.max(0, Math.min(seg.end, d.end) - Math.max(seg.start, d.start))
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestSpeaker = d.speaker
      }
    }
    return {
      ...seg,
      speaker: bestSpeaker !== null ? `SPK${bestSpeaker + 1}` : null
    }
  })
}
