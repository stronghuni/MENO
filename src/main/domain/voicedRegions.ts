/**
 * Energy-based voiced-region detector for the post-Whisper hallucination
 * filter (Tier 2 Mode A from docs/anti-hallucination).
 *
 * Why energy gate and not a real VAD model: Silero/webrtcvad would be more
 * accurate but onnxruntime on Apple Silicon already cost us speaker
 * diarization (KleidiAI Conv SIGTRAP). A pure-JS RMS gate has zero new
 * dependencies, zero crash risk, and is good enough to catch the case we
 * actually care about — whole minutes of silence where Whisper hallucinates
 * subtitle credits / "안녕하세요" loops.
 *
 * Pipeline:
 *   1. Slice PCM into 30 ms frames, compute RMS → dBFS per frame.
 *   2. Estimate noise floor as the 10th-percentile frame dB (clamped so a
 *      truly silent room doesn't push the threshold absurdly low).
 *   3. Mark frames above `floor + thresholdDb` as voiced.
 *   4. Glue contiguous voiced frames into regions; bridge gaps shorter than
 *      `maxGapMs`; drop regions shorter than `minVoicedMs`.
 *
 * The caller then uses {@link overlapVoicedSec} to keep only Whisper
 * segments whose time range actually overlaps speech.
 */

export interface VoicedRegion {
  /** Start in seconds, relative to the start of the PCM buffer. */
  startSec: number
  /** End in seconds, exclusive. */
  endSec: number
}

export interface VoicedRegionOptions {
  sampleRate: number
  frameMs: number
  /** A frame is voiced when its dBFS exceeds `noiseFloor + thresholdDb`. */
  thresholdDb: number
  /** Drop regions shorter than this — guards against single-frame blips. */
  minVoicedMs: number
  /** Merge regions separated by gaps shorter than this. */
  maxGapMs: number
  /**
   * Lower bound on the noise-floor estimate. Prevents an extremely quiet
   * recording from pushing the threshold below the digital-zero RMS, which
   * would mark literally every frame as voiced.
   */
  minFloorDb: number
  /**
   * Upper bound on the noise-floor estimate. Needed for recordings where
   * the 10th-percentile frame is already loud (no real silence anywhere) —
   * without a cap, the threshold rises with the floor and nothing reads as
   * voiced. Capping at -30 dBFS keeps a reasonable speech-vs-silence gap.
   */
  maxFloorDb: number
}

const DEFAULTS: VoicedRegionOptions = {
  sampleRate: 16000,
  frameMs: 30,
  thresholdDb: 8,
  minVoicedMs: 200,
  maxGapMs: 300,
  minFloorDb: -55,
  maxFloorDb: -30
}

function frameDb(pcm: Float32Array, frameSize: number): Float64Array {
  const n = Math.floor(pcm.length / frameSize)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const start = i * frameSize
    let sum = 0
    for (let j = 0; j < frameSize; j++) {
      const s = pcm[start + j]
      sum += s * s
    }
    const rms = Math.sqrt(sum / frameSize)
    // +1e-12 to keep log10 finite on pure-zero frames.
    out[i] = 20 * Math.log10(rms + 1e-12)
  }
  return out
}

function percentile(arr: Float64Array, p: number): number {
  if (arr.length === 0) return 0
  // Copy + in-place sort — arr.length is bounded by (duration_s × 33fps),
  // so even an hour-long recording is ~120k floats; sort is fine.
  const sorted = Float64Array.from(arr).sort()
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)))
  return sorted[idx]
}

export function computeVoicedRegions(
  pcm: Float32Array,
  opts: Partial<VoicedRegionOptions> = {}
): VoicedRegion[] {
  const cfg = { ...DEFAULTS, ...opts }
  const frameSize = Math.floor((cfg.frameMs * cfg.sampleRate) / 1000)
  if (frameSize <= 0 || pcm.length < frameSize) return []
  const db = frameDb(pcm, frameSize)
  if (db.length === 0) return []
  const floor = Math.min(cfg.maxFloorDb, Math.max(cfg.minFloorDb, percentile(db, 10)))
  const voicedThreshold = floor + cfg.thresholdDb
  const frameSec = cfg.frameMs / 1000

  // Walk frames and collect raw voiced spans.
  const raw: VoicedRegion[] = []
  let openStart = -1
  for (let i = 0; i < db.length; i++) {
    const isVoiced = db[i] > voicedThreshold
    if (isVoiced && openStart < 0) {
      openStart = i
    } else if (!isVoiced && openStart >= 0) {
      raw.push({ startSec: openStart * frameSec, endSec: i * frameSec })
      openStart = -1
    }
  }
  if (openStart >= 0) {
    raw.push({ startSec: openStart * frameSec, endSec: db.length * frameSec })
  }

  // Merge regions across short gaps so a brief pause inside speech doesn't
  // split one utterance into many fragments.
  const maxGapSec = cfg.maxGapMs / 1000
  const merged: VoicedRegion[] = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    if (last && r.startSec - last.endSec <= maxGapSec) {
      last.endSec = r.endSec
    } else {
      merged.push({ ...r })
    }
  }

  // Discard sub-threshold spans (single clicks, mouse noise, etc).
  const minSec = cfg.minVoicedMs / 1000
  return merged.filter((r) => r.endSec - r.startSec >= minSec)
}

/**
 * Total seconds in `[startSec, endSec]` that fall inside any voiced region.
 * Voiced regions must be sorted and non-overlapping — that's what
 * {@link computeVoicedRegions} guarantees.
 */
export function overlapVoicedSec(
  startSec: number,
  endSec: number,
  voiced: VoicedRegion[]
): number {
  if (endSec <= startSec) return 0
  let total = 0
  for (const v of voiced) {
    if (v.endSec <= startSec) continue
    if (v.startSec >= endSec) break
    const lo = Math.max(startSec, v.startSec)
    const hi = Math.min(endSec, v.endSec)
    if (hi > lo) total += hi - lo
  }
  return total
}
