/**
 * Single registry of IPC handlers shared by `ipcMain.handle` (Electron) and
 * the dev HTTP bridge (`devBridge.ts`). Defining channels here lets the
 * browser preview at http://localhost:5173 call exactly the same code path
 * as the production Electron renderer.
 *
 * Handler signature: `(...args: unknown[]) => unknown`. The IpcMainEvent
 * arg that Electron normally passes first is dropped at the wrapping
 * layer — handlers see only the user-supplied args.
 */

import {
  createMeeting,
  deleteMeeting,
  deleteMeetings,
  getMeeting,
  listMeetings,
  updateMeeting
} from './services/storage'
import {
  appendChunk,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopRecording
} from './services/recording'
import { getProcessingStatus, processRecording } from './services/processor'
import { isModelInstalled } from './services/transcriber'
import { getDiarizationStatus, isDiarizationInstalled } from './services/diarizer'
import { isLlmInstalled } from './services/summarizer'
import { clearChatHistory, getChatHistory, sendMessage } from './services/chat'
import { deleteSecret, getSecret, hasSecret, setSecret, SecretKey } from './services/keychain'
import { loadSettings, saveSettings, Settings } from './services/settings'
import { searchDatabases, uploadMeeting } from './services/notion'
import { cancelDownload, downloadModel, MODEL_SPECS, ModelSpec } from './services/downloader'
import { dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import type { Meeting, RecordingStartParams } from '../shared/types'

export type Handler = (...args: unknown[]) => unknown

export const handlers: Record<string, Handler> = {
  // ── meetings ──────────────────────────────────────────────────────────
  'meetings:list': () => listMeetings(),
  'meetings:get': (id) => getMeeting(id as string),
  'meetings:create': (input) =>
    createMeeting(input as string | { title: string; startedAt?: number; attendees?: string[] }),
  'meetings:update': (id, patch) => updateMeeting(id as string, patch as Partial<Meeting>),
  'meetings:delete': (id) => {
    deleteMeeting(id as string)
    return null
  },
  'meetings:deleteMany': (ids) => deleteMeetings(ids as string[]),

  // ── recording ─────────────────────────────────────────────────────────
  'recording:start': (params) =>
    startRecording((params as RecordingStartParams).meetingId, (params as RecordingStartParams).sampleRate),
  'recording:chunk': (meetingId, pcm) => {
    appendChunk(meetingId as string, pcm as ArrayBuffer)
    return null
  },
  'recording:stop': (meetingId) => stopRecording(meetingId as string),
  'recording:pause': (meetingId) => pauseRecording(meetingId as string),
  'recording:resume': (meetingId) => resumeRecording(meetingId as string),

  // ── processing ────────────────────────────────────────────────────────
  'processing:status': (meetingId) => getProcessingStatus(meetingId as string),
  'processing:reprocess': async (meetingId) => {
    const meeting = getMeeting(meetingId as string)
    if (!meeting?.audioPath) throw new Error('No audio to process')
    void processRecording(meetingId as string, meeting.audioPath)
    return null
  },

  // ── models ────────────────────────────────────────────────────────────
  'models:whisperInstalled': () => isModelInstalled(),
  'models:diarizationInstalled': () => isDiarizationInstalled(),
  'models:diarizationStatus': () => getDiarizationStatus(),
  'models:llmInstalled': () => isLlmInstalled(),

  // ── secrets / settings ────────────────────────────────────────────────
  'secrets:set': (key, value) => setSecret(key as SecretKey, value as string),
  'secrets:get': (key) => getSecret(key as SecretKey),
  'secrets:delete': (key) => deleteSecret(key as SecretKey),
  'secrets:has': (key) => hasSecret(key as SecretKey),
  'settings:load': () => loadSettings(),
  'settings:save': (patch) => saveSettings(patch as Partial<Settings>),

  // ── notion ────────────────────────────────────────────────────────────
  'notion:databases': () => searchDatabases(),
  'notion:upload': (meetingId) => uploadMeeting(meetingId as string),

  // ── downloads ─────────────────────────────────────────────────────────
  'downloads:specs': () => MODEL_SPECS,
  'downloads:start': (key) => downloadModel(key as ModelSpec['key']),
  'downloads:cancel': (key) => cancelDownload(key as ModelSpec['key']),

  // ── chat (Qwen-backed assistant — global, optionally scoped) ─────────
  'chat:history': () => getChatHistory(),
  'chat:send': (args) =>
    sendMessage(args as { meetingIds: string[] | null; message: string }),
  'chat:clear': () => {
    clearChatHistory()
    return null
  },

  // ── shell ─────────────────────────────────────────────────────────────
  'shell:openPath': (path) => shell.openPath(path as string),
  'shell:exportNotes': async (meetingId) => {
    const meeting = getMeeting(meetingId as string)
    if (!meeting?.notesMd) throw new Error('회의록이 없습니다.')
    const safeTitle = meeting.title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80)
    const result = await dialog.showSaveDialog({
      title: '회의록 저장',
      defaultPath: `${safeTitle}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '모든 파일', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, meeting.notesMd, 'utf-8')
    return result.filePath
  }
}
