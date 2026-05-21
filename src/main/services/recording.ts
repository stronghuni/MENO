import { statfs } from 'fs/promises'
import { join } from 'path'
import { WavWriter } from './wavWriter'
import { getRecordingsDir, updateMeeting } from './storage'
import { processRecording } from './processor'
import { broadcast } from './broadcaster'
import type { Meeting } from '../../shared/types'

// We removed the rolling-window live transcription pass that ran every few
// seconds during recording — by product decision, the recording view now
// shows just a waveform animation and we transcribe once on stop. That
// avoids the heavy double Whisper load (live + post-stop) and lets the
// final transcript be the only source of truth.

// Safety guards. A 1-hour 16kHz mono 16-bit WAV is ~115MB; we abort if the
// disk has less than 1GB free at start, and auto-stop after 8 hours to
// prevent runaway recordings from filling the drive.
const MIN_FREE_BYTES = 1 * 1024 * 1024 * 1024
const MAX_DURATION_MS = 8 * 60 * 60 * 1000
const SOFT_WARN_DURATION_MS = 2 * 60 * 60 * 1000

interface ActiveRecording {
  meetingId: string
  writer: WavWriter
  audioPath: string
  startedAt: number
  watchdogTimer: NodeJS.Timeout | null
  softWarned: boolean
  paused: boolean
  pausedAccumMs: number
  pausedAt: number | null
}

const sessions = new Map<string, ActiveRecording>()

function broadcastWatchdog(meetingId: string, message: string, severity: 'warn' | 'stop'): void {
  broadcast('recording:watchdog', { meetingId, message, severity })
}

async function getFreeDiskBytes(path: string): Promise<number> {
  try {
    const stats = await statfs(path)
    return stats.bavail * stats.bsize
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export async function startRecording(
  meetingId: string,
  sampleRate: number
): Promise<{ audioPath: string }> {
  if (sessions.has(meetingId)) {
    throw new Error(`Recording already active for meeting ${meetingId}`)
  }
  const recordingsDir = getRecordingsDir()
  const free = await getFreeDiskBytes(recordingsDir)
  if (free < MIN_FREE_BYTES) {
    const freeGB = (free / 1024 ** 3).toFixed(2)
    throw new Error(`디스크 여유 공간이 부족합니다 (${freeGB}GB). 최소 1GB가 필요합니다.`)
  }
  const audioPath = join(recordingsDir, `${meetingId}.wav`)
  const writer = new WavWriter(audioPath, sampleRate)
  const session: ActiveRecording = {
    meetingId,
    writer,
    audioPath,
    startedAt: Date.now(),
    watchdogTimer: null,
    softWarned: false,
    paused: false,
    pausedAccumMs: 0,
    pausedAt: null
  }
  sessions.set(meetingId, session)
  session.watchdogTimer = setInterval(() => {
    const elapsed = Date.now() - session.startedAt
    if (elapsed >= MAX_DURATION_MS) {
      broadcastWatchdog(
        meetingId,
        '8시간 한도에 도달해 녹음을 자동으로 종료합니다.',
        'stop'
      )
    } else if (elapsed >= SOFT_WARN_DURATION_MS && !session.softWarned) {
      session.softWarned = true
      broadcastWatchdog(
        meetingId,
        '녹음이 2시간을 넘었습니다. 곧 종료하거나 분할 녹음을 고려하세요.',
        'warn'
      )
    }
  }, 30_000)
  return { audioPath }
}

export function appendChunk(meetingId: string, pcm: ArrayBuffer): void {
  const session = sessions.get(meetingId)
  if (!session) throw new Error(`No active recording for ${meetingId}`)
  if (session.paused) return
  session.writer.appendPcm(new Float32Array(pcm))
}

export function pauseRecording(meetingId: string): { paused: boolean } {
  const session = sessions.get(meetingId)
  if (!session) throw new Error(`No active recording for ${meetingId}`)
  if (session.paused) return { paused: true }
  session.paused = true
  session.pausedAt = Date.now()
  return { paused: true }
}

export function resumeRecording(meetingId: string): { paused: boolean } {
  const session = sessions.get(meetingId)
  if (!session) throw new Error(`No active recording for ${meetingId}`)
  if (!session.paused) return { paused: false }
  session.paused = false
  if (session.pausedAt) {
    session.pausedAccumMs += Date.now() - session.pausedAt
    session.pausedAt = null
  }
  return { paused: false }
}

export async function stopRecording(meetingId: string): Promise<Meeting> {
  const session = sessions.get(meetingId)
  if (!session) throw new Error(`No active recording for ${meetingId}`)
  if (session.watchdogTimer) clearInterval(session.watchdogTimer)
  sessions.delete(meetingId)
  const { durationMs } = await session.writer.close()
  const endedAt = Date.now()
  const meeting = updateMeeting(meetingId, {
    audioPath: session.audioPath,
    endedAt,
    durationMs
  })
  void processRecording(meetingId, session.audioPath)
  return meeting
}

/**
 * Close any active WavWriters so the RIFF header gets patched and the file
 * is a valid WAV. Used by the main process on `before-quit` to keep the
 * library from collecting half-written 0-byte files when the user quits
 * while recording.
 */
export async function gracefulShutdown(): Promise<void> {
  const tasks: Promise<unknown>[] = []
  for (const [meetingId, session] of sessions.entries()) {
    if (session.watchdogTimer) clearInterval(session.watchdogTimer)
    sessions.delete(meetingId)
    tasks.push(
      session.writer
        .close()
        .then(({ durationMs }) =>
          updateMeeting(meetingId, {
            audioPath: session.audioPath,
            endedAt: Date.now(),
            durationMs
          })
        )
        .catch((e) => console.error(`Shutdown finalize failed for ${meetingId}:`, e))
    )
  }
  await Promise.all(tasks)
}
