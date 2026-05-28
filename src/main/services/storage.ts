import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { broadcast } from './broadcaster'
import type { Meeting, Project, ScheduledEvent, CreateEventInput } from '../../shared/types'

function broadcastMeetingsChanged(): void {
  broadcast('meetings:changed', null)
}

let db: Database.Database | null = null

export function getRecordingsDir(): string {
  const dir = join(app.getPath('userData'), 'recordings')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getModelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDb(): Database.Database {
  if (db) return db
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'meno.db')
  // Migrate from the previous DB filename. We also move the WAL/SHM
  // sidecars so the new file opens cleanly with WAL still intact.
  const legacyPath = join(userData, 'meeting-notes.db')
  if (existsSync(legacyPath) && !existsSync(dbPath)) {
    try {
      renameSync(legacyPath, dbPath)
      for (const ext of ['-shm', '-wal']) {
        if (existsSync(legacyPath + ext)) renameSync(legacyPath + ext, dbPath + ext)
      }
      console.log('[migration] DB: meeting-notes.db → meno.db')
    } catch (e) {
      console.error('[migration] DB rename failed:', e)
    }
  }
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_ms INTEGER,
      audio_path TEXT,
      transcript_json TEXT,
      notes_md TEXT,
      attendees_json TEXT,
      tags_json TEXT,
      notion_page_url TEXT,
      notion_uploaded_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON meetings(started_at DESC);

    -- Relationship graph: entities (people/topics) shared across meetings.
    -- A meeting links to the entities it mentions; two meetings are
    -- "related" when they share entities. Kept in the same SQLite DB
    -- (no separate graph engine) — sufficient for personal-scale graphs.
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,          -- 'person' | 'topic'
      name TEXT NOT NULL,          -- display form
      norm TEXT NOT NULL,          -- normalized dedup key
      UNIQUE(type, norm)
    );
    CREATE TABLE IF NOT EXISTS graph_meeting_nodes (
      meeting_id TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      PRIMARY KEY (meeting_id, node_id),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gmn_node ON graph_meeting_nodes(node_id);
    CREATE INDEX IF NOT EXISTS idx_gmn_meeting ON graph_meeting_nodes(meeting_id);

    -- Projects group meetings. A meeting belongs to at most one project.
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      created_at INTEGER NOT NULL
    );

    -- Scheduled (upcoming) meeting events shown on the calendar. Distinct
    -- from the meetings table (recorded sessions). May be auto-created from
    -- a source meeting's next-meeting mention, or added manually.
    CREATE TABLE IF NOT EXISTS scheduled_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      project_id TEXT,
      source_meeting_id TEXT,
      auto INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'scheduled',
      notified_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_scheduled_at ON scheduled_events(scheduled_at);
  `)
  // Additive migrations — each ALTER may error with "duplicate column"
  // on already-migrated DBs; we swallow that.
  for (const column of ['chat_history_json TEXT', 'project_id TEXT']) {
    try {
      db.exec(`ALTER TABLE meetings ADD COLUMN ${column}`)
    } catch (e) {
      const msg = (e as Error).message
      if (!/duplicate column/i.test(msg)) throw e
    }
  }
}

interface MeetingRow {
  id: string
  title: string
  started_at: number
  ended_at: number | null
  duration_ms: number | null
  audio_path: string | null
  transcript_json: string | null
  notes_md: string | null
  attendees_json: string | null
  tags_json: string | null
  notion_page_url: string | null
  notion_uploaded_at: number | null
  chat_history_json: string | null
  project_id: string | null
  created_at: number
  updated_at: number
}

function rowToMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    audioPath: row.audio_path,
    transcriptJson: row.transcript_json,
    notesMd: row.notes_md,
    attendeesJson: row.attendees_json,
    tagsJson: row.tags_json,
    notionPageUrl: row.notion_page_url,
    notionUploadedAt: row.notion_uploaded_at,
    chatHistoryJson: row.chat_history_json ?? null,
    projectId: row.project_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface CreateMeetingInput {
  title: string
  /**
   * Scheduled / planned meeting time. Defaults to now when omitted.
   * Stored in the `started_at` column so the rest of the codebase (sidebar
   * recent list, library cards, prompts) keeps working unchanged.
   */
  startedAt?: number
  /** Pre-populated attendee list from the new-meeting form. */
  attendees?: string[]
  /** Project this meeting belongs to (groups meetings). */
  projectId?: string | null
}

export function createMeeting(input: string | CreateMeetingInput): Meeting {
  const normalized: CreateMeetingInput = typeof input === 'string' ? { title: input } : input
  const now = Date.now()
  const id = crypto.randomUUID()
  const startedAt = normalized.startedAt ?? now
  const attendeesJson =
    normalized.attendees && normalized.attendees.length > 0
      ? JSON.stringify(normalized.attendees)
      : null
  const meeting: Meeting = {
    id,
    title: normalized.title,
    startedAt,
    endedAt: null,
    durationMs: null,
    audioPath: null,
    transcriptJson: null,
    notesMd: null,
    attendeesJson,
    tagsJson: null,
    notionPageUrl: null,
    notionUploadedAt: null,
    chatHistoryJson: null,
    projectId: normalized.projectId ?? null,
    createdAt: now,
    updatedAt: now
  }
  getDb()
    .prepare(
      `INSERT INTO meetings (id, title, started_at, attendees_json, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, normalized.title, startedAt, attendeesJson, meeting.projectId, now, now)
  broadcastMeetingsChanged()
  return meeting
}

export function getMeeting(id: string): Meeting | null {
  const row = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
    | MeetingRow
    | undefined
  return row ? rowToMeeting(row) : null
}

export function listMeetings(): Meeting[] {
  const rows = getDb()
    .prepare('SELECT * FROM meetings ORDER BY started_at DESC')
    .all() as MeetingRow[]
  return rows.map(rowToMeeting)
}

const fieldMap: Record<keyof Meeting, string | null> = {
  id: 'id',
  title: 'title',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  durationMs: 'duration_ms',
  audioPath: 'audio_path',
  transcriptJson: 'transcript_json',
  notesMd: 'notes_md',
  attendeesJson: 'attendees_json',
  tagsJson: 'tags_json',
  notionPageUrl: 'notion_page_url',
  notionUploadedAt: 'notion_uploaded_at',
  chatHistoryJson: 'chat_history_json',
  projectId: 'project_id',
  createdAt: null,
  updatedAt: null
}

export function updateMeeting(id: string, patch: Partial<Meeting>): Meeting {
  const sets: string[] = []
  const values: unknown[] = []
  for (const key of Object.keys(patch) as (keyof Meeting)[]) {
    const column = fieldMap[key]
    if (!column) continue
    sets.push(`${column} = ?`)
    values.push(patch[key])
  }
  sets.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)
  getDb()
    .prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values)
  const meeting = getMeeting(id)
  if (!meeting) throw new Error(`Meeting ${id} not found after update`)
  broadcastMeetingsChanged()
  return meeting
}

export function deleteMeeting(id: string): void {
  const meeting = getMeeting(id)
  if (meeting?.audioPath && existsSync(meeting.audioPath)) {
    try {
      unlinkSync(meeting.audioPath)
    } catch (e) {
      console.warn(`Failed to delete audio file ${meeting.audioPath}:`, e)
    }
  }
  getDb().prepare('DELETE FROM meetings WHERE id = ?').run(id)
  broadcastMeetingsChanged()
}

/**
 * Bulk variant. Runs the DELETEs inside a single transaction so a large
 * selection from the library doesn't generate N SSE events — we broadcast
 * once at the end. Audio files are still removed individually because
 * they live outside the DB.
 */
export function deleteMeetings(ids: string[]): { deleted: number } {
  if (ids.length === 0) return { deleted: 0 }
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM meetings WHERE id = ?')
  const rows = ids.map((id) => stmt.get(id) as MeetingRow | undefined).filter(Boolean) as MeetingRow[]
  for (const row of rows) {
    if (row.audio_path && existsSync(row.audio_path)) {
      try {
        unlinkSync(row.audio_path)
      } catch (e) {
        console.warn(`Failed to delete audio file ${row.audio_path}:`, e)
      }
    }
  }
  const del = db.transaction((targets: string[]) => {
    const dstmt = db.prepare('DELETE FROM meetings WHERE id = ?')
    let count = 0
    for (const id of targets) {
      const info = dstmt.run(id)
      count += info.changes
    }
    return count
  })
  const deleted = del(ids)
  if (deleted > 0) broadcastMeetingsChanged()
  return { deleted }
}

// ── Projects ─────────────────────────────────────────────────────────────
interface ProjectRow {
  id: string
  name: string
  color: string | null
  created_at: number
}

function rowToProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, color: r.color, createdAt: r.created_at }
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY created_at ASC')
    .all() as ProjectRow[]
  return rows.map(rowToProject)
}

export function createProject(name: string, color?: string | null): Project {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO projects (id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.trim(), color ?? null, now)
  broadcastMeetingsChanged()
  return { id, name: name.trim(), color: color ?? null, createdAt: now }
}

export function deleteProject(id: string): void {
  // Detach meetings from the project (don't delete the meetings), then drop it.
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('UPDATE meetings SET project_id = NULL WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  })
  tx()
  broadcastMeetingsChanged()
}

// ── Scheduled events (calendar) ──────────────────────────────────────────
interface EventRow {
  id: string
  title: string
  scheduled_at: number
  project_id: string | null
  source_meeting_id: string | null
  auto: number
  status: string
  notified_at: number | null
  created_at: number
}

function rowToEvent(r: EventRow): ScheduledEvent {
  return {
    id: r.id,
    title: r.title,
    scheduledAt: r.scheduled_at,
    projectId: r.project_id,
    sourceMeetingId: r.source_meeting_id,
    auto: r.auto === 1,
    status: (r.status as ScheduledEvent['status']) ?? 'scheduled',
    notifiedAt: r.notified_at,
    createdAt: r.created_at
  }
}

export function listEvents(): ScheduledEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_events ORDER BY scheduled_at ASC')
    .all() as EventRow[]
  return rows.map(rowToEvent)
}

export function createEvent(input: CreateEventInput): ScheduledEvent {
  const id = crypto.randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO scheduled_events
       (id, title, scheduled_at, project_id, source_meeting_id, auto, status, notified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, ?)`
    )
    .run(
      id,
      input.title,
      input.scheduledAt,
      input.projectId ?? null,
      input.sourceMeetingId ?? null,
      input.auto ? 1 : 0,
      now
    )
  broadcast('events:changed', null)
  return {
    id,
    title: input.title,
    scheduledAt: input.scheduledAt,
    projectId: input.projectId ?? null,
    sourceMeetingId: input.sourceMeetingId ?? null,
    auto: !!input.auto,
    status: 'scheduled',
    notifiedAt: null,
    createdAt: now
  }
}

const eventFieldMap: Record<string, string> = {
  title: 'title',
  scheduledAt: 'scheduled_at',
  projectId: 'project_id',
  status: 'status',
  notifiedAt: 'notified_at'
}

export function updateEvent(id: string, patch: Partial<ScheduledEvent>): void {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, col] of Object.entries(eventFieldMap)) {
    if (key in patch) {
      sets.push(`${col} = ?`)
      values.push((patch as Record<string, unknown>)[key])
    }
  }
  if (sets.length === 0) return
  values.push(id)
  getDb()
    .prepare(`UPDATE scheduled_events SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values)
  broadcast('events:changed', null)
}

export function deleteEvent(id: string): void {
  getDb().prepare('DELETE FROM scheduled_events WHERE id = ?').run(id)
  broadcast('events:changed', null)
}

/** Events that are due for notification: lead-time reached, not yet notified. */
export function listDueEvents(leadMs: number): ScheduledEvent[] {
  const threshold = Date.now() + leadMs
  const rows = getDb()
    .prepare(
      `SELECT * FROM scheduled_events
       WHERE status = 'scheduled' AND notified_at IS NULL AND scheduled_at <= ?
       ORDER BY scheduled_at ASC`
    )
    .all(threshold) as EventRow[]
  return rows.map(rowToEvent)
}
