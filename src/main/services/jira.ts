import { getMeeting } from './storage'
import { getSecret } from './keychain'
import { loadSettings } from './settings'
import { parseActionItems, mapPriority, normalizeDueDate } from '../domain/actionItems'
import type {
  JiraProject,
  JiraIssueType,
  JiraExportResult,
  JiraCreatedIssue
} from '../../shared/types'

/**
 * Jira Cloud integration: turn a meeting note's action-item table into
 * issues. Auth is Atlassian email + API token (HTTP basic). The token
 * lives in Keychain (`jira.token`); the site URL, email, default project
 * key and issue type live in settings.json.
 *
 * No SDK — the REST v3 API is a handful of endpoints and a dependency-free
 * fetch keeps the bundle lean and avoids native rebuild surprises.
 */

interface JiraCreds {
  base: string // normalized site URL, no trailing slash
  email: string
  token: string
}

async function getCreds(): Promise<JiraCreds> {
  const s = loadSettings()
  const token = await getSecret('jira.token')
  if (!s.jiraSiteUrl || !s.jiraEmail || !token) {
    throw new Error('Jira 설정이 완료되지 않았습니다. (사이트 URL · 이메일 · API 토큰)')
  }
  return {
    base: s.jiraSiteUrl.replace(/\/+$/, ''),
    email: s.jiraEmail,
    token
  }
}

function authHeader(c: JiraCreds): string {
  return 'Basic ' + Buffer.from(`${c.email}:${c.token}`).toString('base64')
}

async function jiraFetch<T>(
  c: JiraCreds,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${c.base}/rest/api/3${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: authHeader(c),
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: init?.body ? JSON.stringify(init.body) : undefined
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> }
      const msgs = [...(j.errorMessages ?? []), ...Object.values(j.errors ?? {})]
      if (msgs.length) detail = msgs.join(' / ')
    } catch {
      // non-JSON error body — keep the status line
    }
    if (res.status === 401) detail = '인증 실패 — 이메일/API 토큰을 확인하세요.'
    throw new Error(`Jira: ${detail}`)
  }
  return (await res.json()) as T
}

/** Validate stored creds by hitting /myself. Returns the display name. */
export async function testJira(): Promise<{ ok: true; displayName: string }> {
  const c = await getCreds()
  const me = await jiraFetch<{ displayName: string }>(c, '/myself')
  return { ok: true, displayName: me.displayName }
}

export async function listProjects(): Promise<JiraProject[]> {
  const c = await getCreds()
  // values endpoint is paginated; first 50 projects is plenty for a picker.
  const data = await jiraFetch<{ values: { id: string; key: string; name: string }[] }>(
    c,
    '/project/search?maxResults=50&orderBy=name'
  )
  return data.values.map((p) => ({ id: p.id, key: p.key, name: p.name }))
}

export async function listIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const c = await getCreds()
  const proj = await jiraFetch<{ issueTypes?: { id: string; name: string; subtask?: boolean }[] }>(
    c,
    `/project/${encodeURIComponent(projectKey)}`
  )
  return (proj.issueTypes ?? [])
    .filter((t) => !t.subtask)
    .map((t) => ({ id: t.id, name: t.name }))
}

/** Best-effort name → accountId. Returns the id only when exactly one
 *  active user matches, so we never assign to the wrong person. */
async function findAssignee(c: JiraCreds, name: string): Promise<string | null> {
  const q = name.trim()
  if (!q || q === '미정') return null
  try {
    const users = await jiraFetch<{ accountId: string; displayName: string; active: boolean }[]>(
      c,
      `/user/search?query=${encodeURIComponent(q)}`
    )
    const active = users.filter((u) => u.active)
    return active.length === 1 ? active[0].accountId : null
  } catch {
    return null
  }
}

function adfParagraph(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  }
}

/**
 * Parse the meeting's action items and create one Jira issue per row under
 * the configured project + issue type. Each issue is independent — one
 * failure doesn't abort the rest; the result lists per-row outcomes.
 */
export async function exportActionItems(meetingId: string): Promise<JiraExportResult> {
  const c = await getCreds()
  const s = loadSettings()
  if (!s.jiraProjectKey) throw new Error('Jira 프로젝트가 선택되지 않았습니다.')
  const issueType = s.jiraIssueType || 'Task'

  const meeting = getMeeting(meetingId)
  if (!meeting) throw new Error('회의를 찾을 수 없습니다.')
  const items = parseActionItems(meeting.notesMd)
  if (items.length === 0) {
    return { created: [], total: 0, succeeded: 0 }
  }

  const created: JiraCreatedIssue[] = []
  for (const item of items) {
    try {
      const assigneeId = await findAssignee(c, item.assignee)
      const due = normalizeDueDate(item.due)
      const priority = mapPriority(item.priority)

      // Build a description noting source meeting + the raw assignee (so a
      // failed name match still records who it's for).
      const descLines = [`회의: ${meeting.title}`]
      if (item.assignee && !assigneeId) descLines.push(`담당(원문): ${item.assignee}`)
      if (item.due && !due) descLines.push(`기한(원문): ${item.due}`)

      const fields: Record<string, unknown> = {
        project: { key: s.jiraProjectKey },
        issuetype: { name: issueType },
        summary: item.task.slice(0, 250),
        description: adfParagraph(descLines.join('\n'))
      }
      if (assigneeId) fields.assignee = { accountId: assigneeId }
      if (due) fields.duedate = due
      if (priority) fields.priority = { name: priority }

      const res = await jiraFetch<{ key: string }>(c, '/issue', {
        method: 'POST',
        body: { fields }
      })
      created.push({
        task: item.task,
        key: res.key,
        url: `${c.base}/browse/${res.key}`,
        error: null
      })
    } catch (e) {
      created.push({
        task: item.task,
        key: null,
        url: null,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  return {
    created,
    total: items.length,
    succeeded: created.filter((x) => x.key).length
  }
}
