/**
 * End-to-end pipeline smoke test. Run with:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/e2e-pipeline.cjs
 *
 * Uses the same Electron-rebuilt native modules the real app loads
 * (better-sqlite3, smart-whisper, sherpa-onnx-node). Reads the synthesized
 * /tmp/mn-e2e/test.wav and prints transcript + speaker output. Skips
 * llama.cpp because its first-use binary auto-download adds 60–120s.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const MODELS_DIR = path.join(os.homedir(), 'Library/Application Support/meeting-notes/models')
const WHISPER_MODEL = path.join(MODELS_DIR, 'ggml-large-v3-turbo.bin')
const SEG_MODEL = path.join(MODELS_DIR, 'sherpa-onnx-pyannote-segmentation-3-0.onnx')
const EMB_MODEL = path.join(MODELS_DIR, '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx')

const WAV_PATH = '/tmp/mn-e2e/test.wav'

function log(label, ...rest) {
  console.log(`[${label}]`, ...rest)
}

function readWavMono16(filePath) {
  // Minimal WAV reader for 16-bit PCM mono (the format the app writes).
  const buf = fs.readFileSync(filePath)
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF')
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not WAVE')
  let offset = 12
  let fmt = null
  let dataBytes = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(dataStart),
        channels: buf.readUInt16LE(dataStart + 2),
        sampleRate: buf.readUInt32LE(dataStart + 4),
        bitsPerSample: buf.readUInt16LE(dataStart + 14)
      }
    } else if (id === 'data') {
      dataBytes = buf.subarray(dataStart, dataStart + size)
    }
    offset = dataStart + size + (size % 2)
  }
  if (!fmt || !dataBytes) throw new Error('malformed WAV')
  if (fmt.audioFormat !== 1) throw new Error('unsupported audio format: ' + fmt.audioFormat)
  if (fmt.bitsPerSample !== 16) throw new Error('only 16-bit supported')
  const samples = dataBytes.length / 2 / fmt.channels
  const pcm = new Float32Array(samples)
  if (fmt.channels === 1) {
    for (let i = 0; i < samples; i++) pcm[i] = dataBytes.readInt16LE(i * 2) / 0x8000
  } else {
    for (let i = 0; i < samples; i++) {
      let sum = 0
      for (let c = 0; c < fmt.channels; c++) {
        sum += dataBytes.readInt16LE((i * fmt.channels + c) * 2) / 0x8000
      }
      pcm[i] = sum / fmt.channels
    }
  }
  return { pcm, sampleRate: fmt.sampleRate, channels: fmt.channels }
}

async function run() {
  const t0 = Date.now()
  log('boot', 'Electron-as-Node', process.versions.node, 'ABI', process.versions.modules)

  // ── 1. better-sqlite3 round-trip ────────────────────────────────────────
  log('sqlite', 'open')
  const Database = require('better-sqlite3')
  const dbPath = '/tmp/mn-e2e/e2e.db'
  fs.rmSync(dbPath, { force: true })
  const db = new Database(dbPath)
  db.exec('CREATE TABLE m (id TEXT PRIMARY KEY, title TEXT)')
  db.prepare('INSERT INTO m VALUES (?, ?)').run('abc', 'E2E')
  const row = db.prepare('SELECT * FROM m WHERE id=?').get('abc')
  if (row.title !== 'E2E') throw new Error('sqlite round-trip failed')
  log('sqlite', 'ok')
  db.close()

  // ── 2. WAV read ─────────────────────────────────────────────────────────
  if (!fs.existsSync(WAV_PATH)) throw new Error(`test WAV not found: ${WAV_PATH}`)
  const wav = readWavMono16(WAV_PATH)
  const durSec = wav.pcm.length / wav.sampleRate
  log('wav', `${wav.pcm.length} samples @ ${wav.sampleRate}Hz (${durSec.toFixed(2)}s)`)
  if (wav.sampleRate !== 16000) throw new Error('expected 16kHz')

  // ── 3. Whisper transcription ────────────────────────────────────────────
  if (!fs.existsSync(WHISPER_MODEL)) {
    log('whisper', 'SKIP — model not installed')
  } else {
    const tWhisp0 = Date.now()
    log('whisper', 'loading model', path.basename(WHISPER_MODEL))
    const { Whisper } = require('smart-whisper')
    const w = new Whisper(WHISPER_MODEL, { gpu: true, offload: 0 })
    log('whisper', 'transcribing', durSec.toFixed(2) + 's audio…')
    const task = await w.transcribe(wav.pcm, {
      language: 'ko',
      format: 'simple',
      n_threads: 6,
      print_progress: false,
      print_realtime: false
    })
    const segs = await task.result
    const elapsed = ((Date.now() - tWhisp0) / 1000).toFixed(1)
    log('whisper', `done in ${elapsed}s — ${segs.length} segment(s):`)
    for (const s of segs) {
      console.log(`     [${(s.from / 1000).toFixed(2)}-${(s.to / 1000).toFixed(2)}] ${s.text.trim()}`)
    }
    await w.free()
  }

  // ── 4. sherpa-onnx diarization ──────────────────────────────────────────
  if (!fs.existsSync(SEG_MODEL) || !fs.existsSync(EMB_MODEL)) {
    log('diarize', 'SKIP — models not installed')
  } else {
    const tDiar0 = Date.now()
    log('diarize', 'loading sherpa-onnx…')
    const sherpa = require('sherpa-onnx-node')
    const config = {
      segmentation: { pyannote: { model: SEG_MODEL }, debug: false },
      embedding: { model: EMB_MODEL, debug: false },
      clustering: { numClusters: -1, threshold: 0.5 },
      minDurationOn: 0.3,
      minDurationOff: 0.5
    }
    const diar = new sherpa.OfflineSpeakerDiarization(config)
    log('diarize', 'processing…')
    const out = diar.process(wav.pcm)
    const elapsed = ((Date.now() - tDiar0) / 1000).toFixed(1)
    log('diarize', `done in ${elapsed}s — ${out.length} segment(s):`)
    for (const s of out) {
      console.log(`     [${s.start.toFixed(2)}-${s.end.toFixed(2)}] SPK${s.speaker + 1}`)
    }
  }

  log('total', `${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

run().catch((e) => {
  console.error('[FAIL]', e.message)
  if (e.stack) console.error(e.stack)
  process.exit(1)
})
