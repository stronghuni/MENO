#!/usr/bin/env node
// Performance test for the voiced-region anti-hallucination preprocessor.
//   1. Time computeVoicedRegions on synthetic PCM of various durations
//      (1, 10, 30, 60 minutes) — proves the pre-pass is negligible vs.
//      Whisper's per-chunk cost (minutes).
//   2. Run on every real WAV in ~/Library/Application Support/meno/recordings
//      and report detected voiced regions vs. file duration — sanity-checks
//      the algorithm on real microphone audio.
//
// Run with:  node --experimental-strip-types scripts/perf-voiced-regions.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { computeVoicedRegions, overlapVoicedSec } from '../src/main/domain/voicedRegions.ts'

const SR = 16000

// ── helpers ─────────────────────────────────────────────────────────
function silence(durationSec) {
  return new Float32Array(Math.floor(durationSec * SR))
}
function tone(durationSec, freq = 220, amp = 0.25) {
  const n = Math.floor(durationSec * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}
function noise(durationSec, amp = 0.001) {
  // Very quiet hiss simulating room tone — should NOT register as voiced.
  const n = Math.floor(durationSec * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * (Math.random() * 2 - 1)
  return out
}
function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

// 16-bit PCM mono WAV reader — minimal, matches the project's WAV writer.
function readWav16(path) {
  const buf = readFileSync(path)
  const sr = buf.readUInt32LE(24)
  const bitsPerSample = buf.readUInt16LE(34)
  if (bitsPerSample !== 16) throw new Error(`bits=${bitsPerSample}, expected 16`)
  // Find 'data' chunk
  let off = 12
  while (off < buf.length - 8) {
    const id = buf.slice(off, off + 4).toString('ascii')
    const sz = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      // Recordings interrupted mid-write leave the data chunk size at 0
      // in the header even though the audio bytes are present after it.
      // Fall back to "everything after this point" so we don't lose them.
      const bytes = sz > 0 ? sz : buf.length - off - 8
      const samples = Math.floor(bytes / 2)
      const pcm = new Float32Array(samples)
      for (let i = 0; i < samples; i++) {
        pcm[i] = buf.readInt16LE(off + 8 + i * 2) / 32768
      }
      return { pcm, sampleRate: sr, headerTruncated: sz === 0 }
    }
    off += 8 + sz
  }
  throw new Error('no data chunk')
}

function fmtMs(ms) {
  if (ms < 1) return `${ms.toFixed(3)} ms`
  if (ms < 1000) return `${ms.toFixed(1)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}
function fmtMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── 1. synthetic perf ───────────────────────────────────────────────
console.log('━━━━━━━━━━━ Synthetic PCM — computeVoicedRegions ━━━━━━━━━━━')
console.log('pattern: 70% near-silence + 30% tone, alternating ~10s blocks\n')

function makeMeetingLike(totalSec) {
  // Block pattern that mimics a real meeting: speech spurts with silence between.
  const blocks = []
  let cur = 0
  while (cur < totalSec) {
    const speechLen = Math.min(8 + Math.random() * 6, totalSec - cur)
    blocks.push(tone(speechLen, 200 + Math.random() * 100))
    cur += speechLen
    if (cur >= totalSec) break
    const gapLen = Math.min(2 + Math.random() * 8, totalSec - cur)
    blocks.push(noise(gapLen))
    cur += gapLen
  }
  return concat(...blocks)
}

for (const minutes of [1, 10, 30, 60]) {
  const pcm = makeMeetingLike(minutes * 60)
  const bytes = pcm.length * 4
  // Run twice — first call may pay any JIT warm-up.
  computeVoicedRegions(pcm, { sampleRate: SR })
  const t0 = performance.now()
  const regions = computeVoicedRegions(pcm, { sampleRate: SR })
  const dt = performance.now() - t0
  const voicedSec = regions.reduce((s, r) => s + (r.endSec - r.startSec), 0)
  console.log(
    `  ${String(minutes).padStart(2)} min (${fmtMB(bytes).padStart(8)}, ` +
      `${(pcm.length).toLocaleString().padStart(11)} samples): ` +
      `${fmtMs(dt).padStart(9)}  →  ${String(regions.length).padStart(4)} regions, ` +
      `${voicedSec.toFixed(1)}s voiced (${((voicedSec / (minutes * 60)) * 100).toFixed(0)}%)`
  )
}

// ── 2. overlap lookup perf ──────────────────────────────────────────
console.log('\n━━━━━━━━━━━ overlapVoicedSec — segment-filter lookup cost ━━━━━━━━━━━')
{
  const pcm = makeMeetingLike(60 * 60) // 60 min
  const voiced = computeVoicedRegions(pcm, { sampleRate: SR })
  // Simulate Whisper segment density: ~1 segment / 4 s → 900 segments / hr
  const segs = []
  for (let t = 0; t < 3600; t += 4) segs.push([t, t + 4])
  const N = 100
  const t0 = performance.now()
  for (let i = 0; i < N; i++) {
    for (const [a, b] of segs) overlapVoicedSec(a, b, voiced)
  }
  const dt = performance.now() - t0
  console.log(
    `  ${segs.length.toLocaleString()} segments × ${N} iters across ${voiced.length} voiced regions: ` +
      `${fmtMs(dt)}  (${fmtMs(dt / (segs.length * N))} per lookup)`
  )
}

// ── 3. real WAV files ───────────────────────────────────────────────
console.log('\n━━━━━━━━━━━ Real microphone WAVs ━━━━━━━━━━━')
const wavDir = join(homedir(), 'Library', 'Application Support', 'meno', 'recordings')
let entries = []
try {
  entries = readdirSync(wavDir).filter((f) => f.endsWith('.wav'))
} catch {
  console.log(`  (no recordings dir at ${wavDir})`)
}
for (const name of entries) {
  const path = join(wavDir, name)
  let pcm, sr, headerTruncated
  try {
    ;({ pcm, sampleRate: sr, headerTruncated } = readWav16(path))
  } catch (e) {
    console.log(`  ${name.slice(0, 12)}…  ✗ ${e.message}`)
    continue
  }
  const durSec = pcm.length / sr
  const t0 = performance.now()
  const regions = computeVoicedRegions(pcm, { sampleRate: sr })
  const dt = performance.now() - t0
  const voicedSec = regions.reduce((s, r) => s + (r.endSec - r.startSec), 0)
  const tag = headerTruncated ? ' ⚠ unfinalized' : ''
  console.log(
    `  ${name.slice(0, 12)}…  ${durSec.toFixed(1).padStart(6)}s  ` +
      `→  ${fmtMs(dt).padStart(8)}  ` +
      `${String(regions.length).padStart(3)} regions  ` +
      `${voicedSec.toFixed(1).padStart(5)}s voiced ` +
      `(${((voicedSec / durSec) * 100).toFixed(0).padStart(3)}%)${tag}`
  )
}

console.log()
