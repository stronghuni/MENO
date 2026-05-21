import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { broadcast } from './broadcaster'
import type { Meeting } from '../../shared/types'

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
  const dbPath = join(app.getPath('userData'), 'meeting-notes.db')
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
  `)
  // Additive migrations — each ALTER may error with "duplicate column"
  // on already-migrated DBs; we swallow that.
  for (const column of ['chat_history_json TEXT']) {
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
    createdAt: now,
    updatedAt: now
  }
  getDb()
    .prepare(
      `INSERT INTO meetings (id, title, started_at, attendees_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, normalized.title, startedAt, attendeesJson, now, now)
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
