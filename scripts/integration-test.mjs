#!/usr/bin/env node
/**
 * Backend integration test — exercises pure-JS modules without booting
 * Electron. SQLite + Keychain are skipped because their native addons
 * are pinned to the Electron Node ABI (NODE_MODULE_VERSION 140); those
 * code paths are exercised by booting the real dev app separately.
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmp = mkdtempSync(join(tmpdir(), 'mn-itest-'))

let passed = 0
let failed = 0
function ok(label) {
  passed++
  console.log(`   ✓ ${label}`)
}
function bad(label, err) {
  failed++
  console.log(`   ✗ ${label}`)
  console.log(`     ${err}`)
}

// ─── 1. WAV round-trip ──────────────────────────────────────────────────────
console.log('── 1. WAV round-trip ──')
try {
  const { WavWriter } = await import('../src/main/services/wavWriter.ts')
  const { readWav } = await import('../src/main/services/wavReader.ts')

  const wavPath = join(tmp, 'test.wav')
  const writer = new WavWriter(wavPath, 16000)
  const samples = new Float32Array(16000)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5
  }
  writer.appendPcm(samples)
  const closed = await writer.close()

  const decoded = await readWav(wavPath)
  if (decoded.sampleRate !== 16000) throw new Error('sample rate mismatch')
  if (decoded.pcm.length !== samples.length) throw new Error('sample count mismatch')
  const diff = Math.abs(decoded.pcm[100] - samples[100])
  if (diff > 0.001) throw new Error(`drift ${diff}`)
  ok(`write+read: ${closed.bytes}B, ${closed.durationMs}ms, drift ${diff.toExponential(2)}`)
} catch (e) {
  bad('WAV round-trip', e.message)
}

// ─── 2. merger (transcript + diarization overlap matching) ──────────────────
console.log('\n── 2. merger ──')
try {
  const { mergeTranscriptWithDiarization } = await import('../src/main/domain/merger.ts')
  const merged = mergeTranscriptWithDiarization(
    [
      { start: 0, end: 2, speaker: null, text: '안녕하세요' },
      { start: 2.1, end: 4, speaker: null, text: '네 반갑습니다' },
      { start: 10, end: 11, speaker: null, text: '구간 외' }
    ],
    [
      { start: 0, end: 2.05, speaker: 0 },
      { start: 2.05, end: 4.5, speaker: 1 }
    ]
  )
  if (merged[0].speaker !== 'SPK1') throw new Error(`row0 speaker=${merged[0].speaker}`)
  if (merged[1].speaker !== 'SPK2') throw new Error(`row1 speaker=${merged[1].speaker}`)
  if (merged[2].speaker !== null) throw new Error(`row2 speaker should be null, got ${merged[2].speaker}`)
  ok(`labels: ${merged.map((m) => m.speaker ?? 'null').join(', ')}`)
} catch (e) {
  bad('merger', e.message)
}

// ─── 3. prompts ─────────────────────────────────────────────────────────────
console.log('\n── 3. prompts ──')
try {
  const { buildMeetingNotesPrompt, extractAttendees } = await import(
    '../src/main/domain/prompts.ts'
  )
  const segs = [
    { start: 0, end: 5, speaker: 'SPK1', text: '안녕하세요, 회의 시작하겠습니다.' },
    { start: 5, end: 10, speaker: 'SPK2', text: '네, 어제 논의했던 로드맵부터 보겠습니다.' }
  ]
  const prompt = buildMeetingNotesPrompt('제품 회의', Date.parse('2026-05-21T10:00:00'), 3600000, segs)
  if (!prompt.includes('## 주요 안건')) throw new Error('missing 안건 section')
  if (!prompt.includes('## 액션 아이템')) throw new Error('missing 액션 section')
  if (!prompt.includes('SPK1')) throw new Error('SPK1 not in prompt')
  if (!prompt.includes('2026-05-21 10:00')) throw new Error('date format wrong')
  ok(`prompt = ${prompt.length} chars, contains all sections`)

  const attendees = extractAttendees(segs)
  if (attendees.length !== 2) throw new Error(`expected 2 attendees, got ${attendees.length}`)
  ok(`attendees: ${attendees.join(', ')}`)
} catch (e) {
  bad('prompts', e.message)
}

// ─── 4. downloader URL reachability ─────────────────────────────────────────
console.log('\n── 4. downloader URL reachability ──')
try {
  const downloader = await import('../src/main/services/downloader.ts')
  for (const spec of downloader.MODEL_SPECS) {
    const t0 = Date.now()
    const res = await fetch(spec.url, { headers: { Range: 'bytes=0-0' }, method: 'GET' })
    const ms = Date.now() - t0
    const cr = res.headers.get('content-range')
    let total = null
    if (cr) {
      const m = cr.match(/\/(\d+)/)
      if (m) total = parseInt(m[1], 10)
    } else {
      const cl = res.headers.get('content-length')
      if (cl) total = parseInt(cl, 10)
    }
    res.body?.cancel()
    if (res.status === 200 || res.status === 206) {
      const sizeMatch = total
        ? Math.abs(total - spec.approxBytes) / spec.approxBytes < 0.05
          ? '✓ size'
          : `⚠ size drift (${total} vs ${spec.approxBytes})`
        : 'no size header'
      ok(`${spec.key}: ${res.status} ${ms}ms, ${sizeMatch}`)
    } else {
      bad(`${spec.key}`, `HTTP ${res.status} ${res.statusText}`)
    }
  }
} catch (e) {
  bad('downloader URLs', e.message)
}

// ─── 5. Notion martian conversion ───────────────────────────────────────────
console.log('\n── 5. martian (markdown → Notion blocks) ──')
try {
  const { markdownToBlocks } = await import('@tryfabric/martian')
  const md = `# 제목
- **일시**: 2026-05-21 10:00 (1시간)
- **참석자**: SPK1, SPK2

## 주요 안건
- 로드맵 검토
- 우선순위 조정

## 액션 아이템
| 담당 | 내용 | 기한 |
|------|------|------|
| SPK1 | 로드맵 정리 | 5/25 |`
  const blocks = markdownToBlocks(md)
  if (blocks.length === 0) throw new Error('no blocks emitted')
  const heading = blocks.find((b) => b.type === 'heading_1')
  if (!heading) throw new Error('heading_1 missing')
  ok(`produced ${blocks.length} blocks`)
} catch (e) {
  bad('martian', e.message)
}

// ─── summary ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`)
console.log(`(tmp: ${tmp})`)
rmSync(tmp, { recursive: true, force: true })
process.exit(failed > 0 ? 1 : 0)
