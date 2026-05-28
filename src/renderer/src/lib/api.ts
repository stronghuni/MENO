/**
 * `getApi()` resolves the IPC surface for the current runtime.
 *
 * - Inside Electron: returns `window.api` (preload-exposed contextBridge).
 * - In a regular browser tab at http://localhost:5173 during dev:
 *   returns an HTTP shim that talks to the main process's dev bridge
 *   (`startDevBridge` in `src/main/devBridge.ts`). Lets the renderer be
 *   tested in a normal Chrome window without restarting Electron.
 * - Anywhere else: returns null and callers fall back to empty state.
 */

type WindowApi = Window['api']

const DEV_BRIDGE = 'http://127.0.0.1:9877'

let cachedHttp: WindowApi | null = null
let eventSource: EventSource | null = null
const eventListeners = new Map<string, Set<(payload: unknown) => void>>()

function ensureEventSource(): void {
  if (eventSource) return
  eventSource = new EventSource(`${DEV_BRIDGE}/events`)
  // The dev bridge attaches each broadcast as `event: <channel>` so we
  // register one listener per channel as it's first subscribed to.
}

function subscribe(channel: string, cb: (payload: unknown) => void): () => void {
  ensureEventSource()
  let set = eventListeners.get(channel)
  if (!set) {
    set = new Set()
    eventListeners.set(channel, set)
    eventSource?.addEventListener(channel, (e) => {
      const payload = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : null
      eventListeners.get(channel)?.forEach((fn) => {
        try {
          fn(payload)
        } catch (err) {
          console.error(`[http-api] listener for ${channel} threw:`, err)
        }
      })
    })
  }
  set.add(cb)
  return () => set!.delete(cb)
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`${DEV_BRIDGE}/api/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args })
  })
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
  return body.result as T
}

async function invokeBinary<T>(channel: string, meetingId: string, pcm: ArrayBuffer): Promise<T> {
  const res = await fetch(
    `${DEV_BRIDGE}/api/${encodeURIComponent(channel)}?meetingId=${encodeURIComponent(meetingId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pcm
    }
  )
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
  return body.result as T
}

function buildHttpApi(): WindowApi {
  // Shape mirrors src/preload/index.ts:Api so call sites in renderer code
  // don't need to know which transport they're using.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    meetings: {
      list: () => invoke('meetings:list'),
      get: (id: string) => invoke('meetings:get', id),
      create: (
        input:
          | string
          | { title: string; startedAt?: number; attendees?: string[]; projectId?: string | null }
      ) => invoke('meetings:create', input),
      update: (id: string, patch: unknown) => invoke('meetings:update', id, patch),
      delete: (id: string) => invoke('meetings:delete', id),
      deleteMany: (ids: string[]) => invoke('meetings:deleteMany', ids),
      onChanged: (cb: () => void) => subscribe('meetings:changed', () => cb())
    },
    recording: {
      start: (params: unknown) => invoke('recording:start', params),
      chunk: (meetingId: string, pcm: ArrayBuffer) => invokeBinary('recording:chunk', meetingId, pcm),
      stop: (meetingId: string) => invoke('recording:stop', meetingId),
      pause: (meetingId: string) => invoke('recording:pause', meetingId),
      resume: (meetingId: string) => invoke('recording:resume', meetingId),
      onWatchdog: (cb: (e: unknown) => void) =>
        subscribe('recording:watchdog', (p) => cb(p as never))
    },
    processing: {
      status: (id: string) => invoke('processing:status', id),
      reprocess: (id: string) => invoke('processing:reprocess', id),
      onUpdate: (cb: (s: unknown) => void) => subscribe('processing:update', (p) => cb(p as never))
    },
    models: {
      whisperInstalled: () => invoke('models:whisperInstalled'),
      llmInstalled: () => invoke('models:llmInstalled')
    },
    secrets: {
      set: (k: string, v: string) => invoke('secrets:set', k, v),
      get: (k: string) => invoke('secrets:get', k),
      delete: (k: string) => invoke('secrets:delete', k),
      has: (k: string) => invoke('secrets:has', k)
    },
    settings: {
      load: () => invoke('settings:load'),
      save: (patch: unknown) => invoke('settings:save', patch)
    },
    projects: {
      list: () => invoke('projects:list'),
      create: (name: string, color?: string | null) => invoke('projects:create', name, color ?? null),
      delete: (id: string) => invoke('projects:delete', id)
    },
    events: {
      list: () => invoke('events:list'),
      create: (input: unknown) => invoke('events:create', input),
      update: (id: string, patch: unknown) => invoke('events:update', id, patch),
      delete: (id: string) => invoke('events:delete', id),
      onChanged: (cb: () => void) => subscribe('events:changed', () => cb())
    },
    notion: {
      databases: () => invoke('notion:databases'),
      upload: (id: string) => invoke('notion:upload', id)
    },
    jira: {
      test: () => invoke('jira:test'),
      projects: () => invoke('jira:projects'),
      issueTypes: (projectKey: string) => invoke('jira:issueTypes', projectKey),
      export: (id: string) => invoke('jira:export', id)
    },
    graph: {
      connections: () => invoke('graph:connections'),
      related: (id: string) => invoke('graph:related', id),
      entities: (id: string) => invoke('graph:entities', id),
      entityIndex: () => invoke('graph:entityIndex'),
      rebuild: () => invoke('graph:rebuild'),
      onProgress: (cb: (p: unknown) => void) => subscribe('graph:progress', (p) => cb(p as never))
    },
    downloads: {
      specs: () => invoke('downloads:specs'),
      start: (key: string) => invoke('downloads:start', key),
      cancel: (key: string) => invoke('downloads:cancel', key),
      onProgress: (cb: (p: unknown) => void) =>
        subscribe('download:progress', (p) => cb(p as never))
    },
    shell: {
      openPath: (path: string) => invoke('shell:openPath', path),
      exportNotes: (id: string, format: 'md' | 'docx') =>
        invoke('shell:exportNotes', id, format),
      downloadAudio: (id: string) => invoke('shell:downloadAudio', id)
    },
    chat: {
      history: () => invoke('chat:history'),
      send: (args: { meetingIds: string[] | null; message: string }) =>
        invoke('chat:send', args),
      clear: () => invoke('chat:clear'),
      onToken: (cb: (e: unknown) => void) =>
        subscribe('chat:token', (p) => cb(p as never)),
      onUpdate: (cb: (e: unknown) => void) =>
        subscribe('chat:update', (p) => cb(p as never))
    }
  }
  return api as WindowApi
}

export function getApi(): WindowApi | null {
  if (typeof window === 'undefined') return null
  const w = window as Window
  if (w.api) return w.api
  // Dev-bridge fallback: only attempt when served from localhost (Vite dev).
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    if (!cachedHttp) cachedHttp = buildHttpApi()
    return cachedHttp
  }
  return null
}

export function isElectron(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as Window).api)
}
