export interface Meeting {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  audioPath: string | null
  transcriptJson: string | null
  notesMd: string | null
  attendeesJson: string | null
  tagsJson: string | null
  notionPageUrl: string | null
  notionUploadedAt: number | null
  chatHistoryJson: string | null
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
  /**
   * For user messages: which meetings the user explicitly scoped this
   * turn to. `null` (or omitted) means "all meetings". The renderer
   * shows this as chips above the message so you can see what context
   * was active when the question was asked.
   */
  meetingIds?: string[] | null
}

export interface TranscriptSegment {
  start: number
  end: number
  speaker: string | null
  text: string
}

export type ProcessingStage =
  | 'idle'
  | 'transcribing'
  | 'diarizing'
  | 'summarizing'
  | 'uploading'
  | 'done'
  | 'error'

export interface ProcessingStatus {
  meetingId: string
  stage: ProcessingStage
  message?: string
  partialSegments?: TranscriptSegment[]
}

export interface RecordingStartParams {
  meetingId: string
  sampleRate: number
}

export type SecretKey = 'notion.token' | 'huggingface.token'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface AppSettings {
  notionParentId: string | null
  onboardingCompleted: boolean
  theme: ThemeMode
  autoUploadToNotion: boolean
}

export interface NotionTarget {
  id: string
  title: string
  url: string
}

/** @deprecated alias kept for renderer code that still imports the old name */
export type NotionDatabase = NotionTarget

export interface ModelStatus {
  whisper: boolean
  llm: boolean
}

export interface ModelSpec {
  key: 'whisper' | 'llm'
  url: string
  filename: string
  approxBytes: number
}

export interface DownloadProgress {
  key: ModelSpec['key']
  bytesReceived: number
  totalBytes: number
  done: boolean
  error?: string
}
