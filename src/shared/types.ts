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
  projectId: string | null
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  color: string | null
  createdAt: number
}

export interface ScheduledEvent {
  id: string
  title: string
  scheduledAt: number
  projectId: string | null
  sourceMeetingId: string | null
  auto: boolean
  status: 'scheduled' | 'done' | 'cancelled'
  notifiedAt: number | null
  createdAt: number
}

export interface CreateEventInput {
  title: string
  scheduledAt: number
  projectId?: string | null
  sourceMeetingId?: string | null
  auto?: boolean
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

export type SecretKey = 'notion.token' | 'huggingface.token' | 'jira.token'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface AppSettings {
  notionParentId: string | null
  onboardingCompleted: boolean
  theme: ThemeMode
  autoUploadToNotion: boolean
  /** Jira Cloud site, e.g. "https://acme.atlassian.net". */
  jiraSiteUrl: string | null
  /** Atlassian account email used for API-token basic auth. */
  jiraEmail: string | null
  /** Default project key (e.g. "MEET") new issues are created under. */
  jiraProjectKey: string | null
  /** Default issue type name (e.g. "Task"). */
  jiraIssueType: string | null
  /** Auto-create Jira issues from action items after summarization. */
  autoExportToJira: boolean
}

export interface NotionTarget {
  id: string
  title: string
  url: string
}

/** @deprecated alias kept for renderer code that still imports the old name */
export type NotionDatabase = NotionTarget

export interface JiraProject {
  id: string
  key: string
  name: string
}

export interface JiraIssueType {
  id: string
  name: string
}

/** Per-action-item outcome of a Jira export run. */
export interface JiraCreatedIssue {
  task: string
  key: string | null // e.g. "MEET-42", null on failure
  url: string | null
  error: string | null
}

export interface JiraExportResult {
  created: JiraCreatedIssue[]
  total: number
  succeeded: number
}

// ── Relationship graph ──────────────────────────────────────────────
export type GraphEntityType = 'person' | 'topic'

export interface GraphEntity {
  type: GraphEntityType
  name: string
}

/** A meeting related to a given one, with the entities they share. */
export interface RelatedMeeting {
  id: string
  title: string
  startedAt: number
  shared: GraphEntity[]
  score: number
}

/** One row in the connections page: a meeting + its top related meetings. */
export interface MeetingConnections {
  id: string
  title: string
  startedAt: number
  entities: GraphEntity[]
  related: RelatedMeeting[]
}

/** An entity (topic/person) with the meetings it appears in. */
export interface EntityIndexItem {
  type: GraphEntityType
  name: string
  meetings: { id: string; title: string; startedAt: number }[]
}

export interface GraphProgress {
  current: number
  total: number
  title: string | null
}

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
