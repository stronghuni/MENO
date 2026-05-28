import { Notification } from 'electron'
import { listDueEvents, updateEvent } from './storage'

/**
 * Fires a system notification ~10 minutes before each scheduled meeting.
 * A single 60s interval polls the DB for events whose lead time has been
 * reached and that haven't been notified yet, then marks them notified so
 * they don't fire twice. Cheap and survives restarts (state is in SQLite).
 */
const LEAD_MS = 10 * 60 * 1000
let timer: ReturnType<typeof setInterval> | null = null

function check(): void {
  try {
    for (const e of listDueEvents(LEAD_MS)) {
      if (Notification.isSupported()) {
        const d = new Date(e.scheduledAt)
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const soon = e.scheduledAt - Date.now()
        const lead = soon > 60_000 ? `${Math.round(soon / 60000)}분 뒤 ` : '곧 '
        new Notification({
          title: '회의 알림 — MENO',
          body: `${lead}${e.title} (${hh}:${mm})`,
          silent: false
        }).show()
      }
      updateEvent(e.id, { notifiedAt: Date.now() })
    }
  } catch (err) {
    console.warn('[scheduler] check failed:', err)
  }
}

export function startScheduler(): void {
  if (timer) return
  check()
  timer = setInterval(check, 60_000)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
