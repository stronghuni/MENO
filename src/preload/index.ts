import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  ChatMessage,
  DownloadProgress,
  JiraExportResult,
  JiraIssueType,
  JiraProject,
  Meeting,
  ModelSpec,
  NotionDatabase,
  ProcessingStatus,
  RecordingStartParams,
  SecretKey
} from '../shared/types'

const api = {
  meetings: {
    list: (): Promise<Meeting[]> => ipcRenderer.invoke('meetings:list'),
    get: (id: string): Promise<Meeting | null> => ipcRenderer.invoke('meetings:get', id),
    create: (
      input: string | { title: string; startedAt?: number; attendees?: string[] }
    ): Promise<Meeting> => ipcRenderer.invoke('meetings:create', input),
    update: (id: string, patch: Partial<Meeting>): Promise<Meeting> =>
      ipcRenderer.invoke('meetings:update', id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('meetings:delete', id),
    deleteMany: (ids: string[]): Promise<{ deleted: number }> =>
      ipcRenderer.invoke('meetings:deleteMany', ids),
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('meetings:changed', listener)
      return () => ipcRenderer.removeListener('meetings:changed', listener)
    }
  },
  recording: {
    start: (params: RecordingStartParams): Promise<{ audioPath: string }> =>
      ipcRenderer.invoke('recording:start', params),
    chunk: (meetingId: string, pcm: ArrayBuffer): Promise<void> =>
      ipcRenderer.invoke('recording:chunk', meetingId, pcm),
    stop: (meetingId: string): Promise<Meeting> => ipcRenderer.invoke('recording:stop', meetingId),
    pause: (meetingId: string): Promise<{ paused: boolean }> =>
      ipcRenderer.invoke('recording:pause', meetingId),
    resume: (meetingId: string): Promise<{ paused: boolean }> =>
      ipcRenderer.invoke('recording:resume', meetingId),
    onWatchdog: (
      cb: (e: { meetingId: string; message: string; severity: 'warn' | 'stop' }) => void
    ): (() => void) => {
      const listener = (
        _: IpcRendererEvent,
        e: { meetingId: string; message: string; severity: 'warn' | 'stop' }
      ): void => cb(e)
      ipcRenderer.on('recording:watchdog', listener)
      return () => ipcRenderer.removeListener('recording:watchdog', listener)
    }
  },
  processing: {
    status: (meetingId: string): Promise<ProcessingStatus | null> =>
      ipcRenderer.invoke('processing:status', meetingId),
    reprocess: (meetingId: string): Promise<void> =>
      ipcRenderer.invoke('processing:reprocess', meetingId),
    onUpdate: (cb: (s: ProcessingStatus) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, s: ProcessingStatus): void => cb(s)
      ipcRenderer.on('processing:update', listener)
      return () => ipcRenderer.removeListener('processing:update', listener)
    }
  },
  models: {
    whisperInstalled: (): Promise<boolean> => ipcRenderer.invoke('models:whisperInstalled'),
    llmInstalled: (): Promise<boolean> => ipcRenderer.invoke('models:llmInstalled')
  },
  secrets: {
    set: (key: SecretKey, value: string): Promise<void> => ipcRenderer.invoke('secrets:set', key, value),
    get: (key: SecretKey): Promise<string | null> => ipcRenderer.invoke('secrets:get', key),
    delete: (key: SecretKey): Promise<boolean> => ipcRenderer.invoke('secrets:delete', key),
    has: (key: SecretKey): Promise<boolean> => ipcRenderer.invoke('secrets:has', key)
  },
  settings: {
    load: (): Promise<AppSettings> => ipcRenderer.invoke('settings:load'),
    save: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:save', patch)
  },
  notion: {
    databases: (): Promise<NotionDatabase[]> => ipcRenderer.invoke('notion:databases'),
    upload: (meetingId: string): Promise<{ url: string }> =>
      ipcRenderer.invoke('notion:upload', meetingId)
  },
  jira: {
    test: (): Promise<{ ok: true; displayName: string }> => ipcRenderer.invoke('jira:test'),
    projects: (): Promise<JiraProject[]> => ipcRenderer.invoke('jira:projects'),
    issueTypes: (projectKey: string): Promise<JiraIssueType[]> =>
      ipcRenderer.invoke('jira:issueTypes', projectKey),
    export: (meetingId: string): Promise<JiraExportResult> =>
      ipcRenderer.invoke('jira:export', meetingId)
  },
  downloads: {
    specs: (): Promise<ModelSpec[]> => ipcRenderer.invoke('downloads:specs'),
    start: (key: ModelSpec['key']): Promise<void> => ipcRenderer.invoke('downloads:start', key),
    cancel: (key: ModelSpec['key']): Promise<boolean> => ipcRenderer.invoke('downloads:cancel', key),
    onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, p: DownloadProgress): void => cb(p)
      ipcRenderer.on('download:progress', listener)
      return () => ipcRenderer.removeListener('download:progress', listener)
    }
  },
  shell: {
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:openPath', path),
    exportNotes: (meetingId: string, format: 'md' | 'docx'): Promise<string | null> =>
      ipcRenderer.invoke('shell:exportNotes', meetingId, format),
    downloadAudio: (meetingId: string): Promise<string | null> =>
      ipcRenderer.invoke('shell:downloadAudio', meetingId)
  },
  chat: {
    history: (): Promise<ChatMessage[]> => ipcRenderer.invoke('chat:history'),
    send: (args: { meetingIds: string[] | null; message: string }): Promise<ChatMessage> =>
      ipcRenderer.invoke('chat:send', args),
    clear: (): Promise<void> => ipcRenderer.invoke('chat:clear'),
    onToken: (cb: (e: { content: string; done: boolean }) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, e: { content: string; done: boolean }): void =>
        cb(e)
      ipcRenderer.on('chat:token', listener)
      return () => ipcRenderer.removeListener('chat:token', listener)
    },
    onUpdate: (cb: (e: { history: ChatMessage[] }) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, e: { history: ChatMessage[] }): void => cb(e)
      ipcRenderer.on('chat:update', listener)
      return () => ipcRenderer.removeListener('chat:update', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
