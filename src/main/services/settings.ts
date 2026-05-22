import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface Settings {
  /**
   * Notion page that becomes the parent of every meeting note we create.
   * The user picks one of the pages they've granted the Integration
   * access to; uploads land as child pages under it.
   */
  notionParentId: string | null
  onboardingCompleted: boolean
  theme: ThemeMode
  autoUploadToNotion: boolean
  // ── Jira (action items → issues) ──────────────────────────────────
  jiraSiteUrl: string | null
  jiraEmail: string | null
  jiraProjectKey: string | null
  jiraIssueType: string | null
  autoExportToJira: boolean
}

const DEFAULT_SETTINGS: Settings = {
  notionParentId: null,
  onboardingCompleted: false,
  theme: 'auto',
  autoUploadToNotion: true,
  jiraSiteUrl: null,
  jiraEmail: null,
  jiraProjectKey: null,
  jiraIssueType: null,
  autoExportToJira: false
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  const p = getSettingsPath()
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings> & { notionDatabaseId?: string | null }
    // Backward compat: older builds stored the upload target as
    // `notionDatabaseId`. We now use `notionParentId` for the page-mode
    // flow. Drop the legacy value so the user picks a parent page fresh —
    // a stale data-source ID would 404 in page-mode upload.
    if ('notionDatabaseId' in parsed && parsed.notionDatabaseId !== undefined) {
      delete parsed.notionDatabaseId
    }
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings()
  const next = { ...current, ...patch }
  writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2))
  return next
}
