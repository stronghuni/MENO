import { getDb, getMeeting, listMeetings } from './storage'
import { getModel, getLlama, isLlmInstalled } from './summarizer'
import { broadcast as send } from './broadcaster'
import type {
  GraphEntity,
  GraphEntityType,
  RelatedMeeting,
  MeetingConnections,
  EntityIndexItem
} from '../../shared/types'

/**
 * Relationship graph over meetings. Each meeting links to the entities
 * (people / topics) it involves; meetings that share entities are
 * "related". Stored in the main SQLite DB (graph_nodes /
 * graph_meeting_nodes) — no separate graph engine.
 *
 * Entity sources, in order of reliability:
 *   1. attendeesJson  → person nodes  (always present, free)
 *   2. tagsJson       → topic nodes   (always present, free)
 *   3. LLM extraction from notesMd → extra people/topics (new meetings)
 *
 * (1)+(2) mean every existing meeting can be indexed instantly with no
 * model run; (3) enriches new meetings. Entity resolution is normalized
 * string match for now — some duplication (e.g. "로드맵" vs "제품 로드맵")
 * is accepted; embedding/LLM merge is a later enhancement.
 */

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function upsertNode(type: GraphEntityType, name: string): number | null {
  const display = name.trim()
  const norm = normalize(display)
  if (!norm || norm.length > 80) return null
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO graph_nodes (type, name, norm) VALUES (?, ?, ?)').run(
    type,
    display,
    norm
  )
  const row = db
    .prepare('SELECT id FROM graph_nodes WHERE type = ? AND norm = ?')
    .get(type, norm) as { id: number } | undefined
  return row?.id ?? null
}

function linkMeetingNode(meetingId: string, nodeId: number): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO graph_meeting_nodes (meeting_id, node_id) VALUES (?, ?)')
    .run(meetingId, nodeId)
}

function clearMeetingLinks(meetingId: string): void {
  getDb().prepare('DELETE FROM graph_meeting_nodes WHERE meeting_id = ?').run(meetingId)
}

function parseJsonArray(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    people: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } }
  },
  required: ['people', 'topics']
} as const

/**
 * Best-effort LLM extraction of additional people/topics from the notes.
 * JSON-schema-constrained so the output can't be malformed. Returns empty
 * on any failure — callers fall back to the attendees/tags seed.
 */
async function extractEntitiesFromNotes(
  notesMd: string
): Promise<{ people: string[]; topics: string[] }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llama = (await getLlama()) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (await getModel()) as any
    const { LlamaChatSession } = await import('node-llama-cpp')
    const grammar = await llama.createGrammarForJsonSchema(EXTRACT_SCHEMA)
    const context = await model.createContext({ contextSize: 4096 })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = new (LlamaChatSession as any)({ contextSequence: context.getSequence() })
      const prompt = `다음 회의록에서 핵심 엔티티를 추출해 JSON으로만 답하세요.
- people: 회의에 등장한 사람 이름 (실명만, 직책/대명사 제외, 없으면 빈 배열)
- topics: 다룬 핵심 주제·안건·프로젝트명 (명사구 3~7개)
회의록에 실제로 등장한 것만. 지어내지 마세요.

회의록:
${notesMd.slice(0, 6000)}`
      const raw = await session.prompt(prompt, { grammar, maxTokens: 512 })
      const parsed = grammar.parse(raw) as { people?: unknown; topics?: unknown }
      const people = Array.isArray(parsed.people)
        ? (parsed.people as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const topics = Array.isArray(parsed.topics)
        ? (parsed.topics as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      return { people, topics }
    } finally {
      context.dispose()
    }
  } catch (e) {
    console.warn('[graph] LLM entity extraction failed (using seed only):', e)
    return { people: [], topics: [] }
  }
}

/**
 * (Re)index a meeting's entities. Always folds attendees + tags (free);
 * optionally enriches with an LLM pass over the notes.
 */
export async function indexMeeting(meetingId: string, opts: { llm: boolean }): Promise<void> {
  const meeting = getMeeting(meetingId)
  if (!meeting) return

  const people = new Set<string>(parseJsonArray(meeting.attendeesJson))
  const topics = new Set<string>(parseJsonArray(meeting.tagsJson))

  if (opts.llm && meeting.notesMd && isLlmInstalled()) {
    const extracted = await extractEntitiesFromNotes(meeting.notesMd)
    extracted.people.forEach((p) => people.add(p))
    extracted.topics.forEach((t) => topics.add(t))
  }

  const db = getDb()
  const tx = db.transaction(() => {
    clearMeetingLinks(meetingId)
    for (const p of people) {
      const id = upsertNode('person', p)
      if (id != null) linkMeetingNode(meetingId, id)
    }
    for (const t of topics) {
      const id = upsertNode('topic', t)
      if (id != null) linkMeetingNode(meetingId, id)
    }
  })
  tx()
}

/**
 * Faithful re-index of every meeting, including the LLM extraction pass
 * over notes (option A). Slower than a seed-only pass, but it's the right
 * behavior for backfilling old meetings — they get the same rich entities
 * a freshly-recorded meeting would. Progress is broadcast on
 * `graph:progress` so the UI can show a counter.
 */
export async function rebuildGraph(): Promise<{ indexed: number }> {
  const meetings = listMeetings()
  const total = meetings.length
  for (let i = 0; i < total; i++) {
    send('graph:progress', { current: i, total, title: meetings[i].title })
    await indexMeeting(meetings[i].id, { llm: true })
  }
  send('graph:progress', { current: total, total, title: null })
  return { indexed: total }
}

export function getMeetingEntities(meetingId: string): GraphEntity[] {
  const rows = getDb()
    .prepare(
      `SELECT n.type AS type, n.name AS name
       FROM graph_meeting_nodes mn JOIN graph_nodes n ON n.id = mn.node_id
       WHERE mn.meeting_id = ? ORDER BY n.type, n.name`
    )
    .all(meetingId) as { type: GraphEntityType; name: string }[]
  return rows.map((r) => ({ type: r.type, name: r.name }))
}

/**
 * Meetings sharing entities with the given one, ranked by shared count.
 * People count slightly more than topics (a shared person is a stronger
 * signal than a shared keyword).
 */
export function getRelatedMeetings(meetingId: string, limit = 8): RelatedMeeting[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.title AS title, m.started_at AS startedAt,
              n.type AS type, n.name AS name
       FROM graph_meeting_nodes mine
       JOIN graph_meeting_nodes other ON other.node_id = mine.node_id
            AND other.meeting_id <> mine.meeting_id
       JOIN meetings m ON m.id = other.meeting_id
       JOIN graph_nodes n ON n.id = mine.node_id
       WHERE mine.meeting_id = ?`
    )
    .all(meetingId) as {
    id: string
    title: string
    startedAt: number
    type: GraphEntityType
    name: string
  }[]

  const byMeeting = new Map<string, RelatedMeeting>()
  for (const r of rows) {
    let entry = byMeeting.get(r.id)
    if (!entry) {
      entry = { id: r.id, title: r.title, startedAt: r.startedAt, shared: [], score: 0 }
      byMeeting.set(r.id, entry)
    }
    entry.shared.push({ type: r.type, name: r.name })
    entry.score += r.type === 'person' ? 2 : 1
  }
  return Array.from(byMeeting.values())
    .sort((a, b) => b.score - a.score || b.startedAt - a.startedAt)
    .slice(0, limit)
}

/**
 * Entity-centric index: every entity with the meetings it appears in,
 * sorted by reach (most-connective topics/people first). Powers the
 * "click a topic → see its meetings" view.
 */
export function getEntityIndex(): EntityIndexItem[] {
  const rows = getDb()
    .prepare(
      `SELECT n.id AS nodeId, n.type AS type, n.name AS name,
              m.id AS meetingId, m.title AS title, m.started_at AS startedAt
       FROM graph_nodes n
       JOIN graph_meeting_nodes mn ON mn.node_id = n.id
       JOIN meetings m ON m.id = mn.meeting_id
       ORDER BY m.started_at DESC`
    )
    .all() as {
    nodeId: number
    type: GraphEntityType
    name: string
    meetingId: string
    title: string
    startedAt: number
  }[]

  const byNode = new Map<number, EntityIndexItem>()
  for (const r of rows) {
    let item = byNode.get(r.nodeId)
    if (!item) {
      item = { type: r.type, name: r.name, meetings: [] }
      byNode.set(r.nodeId, item)
    }
    item.meetings.push({ id: r.meetingId, title: r.title, startedAt: r.startedAt })
  }
  return Array.from(byNode.values()).sort(
    (a, b) => b.meetings.length - a.meetings.length || a.name.localeCompare(b.name)
  )
}

/** Connections overview: every indexed meeting with its top related set. */
export function getConnections(): MeetingConnections[] {
  return listMeetings().map((m) => ({
    id: m.id,
    title: m.title,
    startedAt: m.startedAt,
    entities: getMeetingEntities(m.id),
    related: getRelatedMeetings(m.id, 5)
  }))
}
