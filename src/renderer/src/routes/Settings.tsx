import { useEffect, useState } from 'react'
import type { NotionTarget, JiraProject, JiraIssueType } from '../../../shared/types'
import { getApi } from '../lib/api'

/** Reduce any pasted form (full URL, host, or bare name) to just the
 *  Jira Cloud subdomain — the editable middle of https://___.atlassian.net. */
function extractSubdomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\.atlassian\.net.*$/i, '')
    .replace(/[/\s]/g, '')
    .toLowerCase()
}

export default function Settings(): React.JSX.Element {
  const api = getApi()
  const [token, setToken] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)
  const [savingToken, setSavingToken] = useState(false)
  const [databases, setDatabases] = useState<NotionTarget[]>([])
  const [dbId, setDbId] = useState<string>('')
  const [autoUpload, setAutoUpload] = useState<boolean>(true)
  const [loadingDbs, setLoadingDbs] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Jira ──────────────────────────────────────────────────────────
  // Store only the subdomain; the full URL is rebuilt as
  // https://<subdomain>.atlassian.net on save.
  const [jiraSubdomain, setJiraSubdomain] = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')
  const [jiraConnected, setJiraConnected] = useState(false)
  const [jiraUser, setJiraUser] = useState<string | null>(null)
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([])
  const [jiraProjectKey, setJiraProjectKey] = useState('')
  const [jiraIssueTypes, setJiraIssueTypes] = useState<JiraIssueType[]>([])
  const [jiraIssueType, setJiraIssueType] = useState('')
  const [jiraBusy, setJiraBusy] = useState(false)
  const [autoJira, setAutoJira] = useState(false)

  useEffect(() => {
    if (!api) return
    void (async (): Promise<void> => {
      const [has, hasJira, settings] = await Promise.all([
        api.secrets.has('notion.token'),
        api.secrets.has('jira.token'),
        api.settings.load()
      ])
      setTokenSaved(has)
      setDbId(settings.notionParentId ?? '')
      setAutoUpload(settings.autoUploadToNotion ?? true)
      if (has) void loadDatabases()

      setJiraSubdomain(extractSubdomain(settings.jiraSiteUrl ?? ''))
      setJiraEmail(settings.jiraEmail ?? '')
      setJiraProjectKey(settings.jiraProjectKey ?? '')
      setJiraIssueType(settings.jiraIssueType ?? '')
      setAutoJira(settings.autoExportToJira ?? false)
      if (hasJira && settings.jiraSiteUrl && settings.jiraEmail) {
        setJiraConnected(true)
        void loadJiraProjects()
        if (settings.jiraProjectKey) void loadJiraIssueTypes(settings.jiraProjectKey)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const loadDatabases = async (): Promise<void> => {
    if (!api) return
    setLoadingDbs(true)
    setError(null)
    try {
      const list = await api.notion.databases()
      setDatabases(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingDbs(false)
    }
  }

  const saveToken = async (): Promise<void> => {
    if (!api || !token.trim()) return
    setSavingToken(true)
    setError(null)
    setMessage(null)
    try {
      await api.secrets.set('notion.token', token.trim())
      setTokenSaved(true)
      setToken('')
      setMessage('토큰을 Keychain에 저장했습니다.')
      await loadDatabases()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingToken(false)
    }
  }

  const clearToken = async (): Promise<void> => {
    if (!api) return
    await api.secrets.delete('notion.token')
    setTokenSaved(false)
    setDatabases([])
    setMessage('토큰을 삭제했습니다.')
  }

  const saveDb = async (id: string): Promise<void> => {
    if (!api) return
    setDbId(id)
    await api.settings.save({ notionParentId: id || null })
    setMessage('부모 페이지를 저장했습니다.')
  }

  const toggleAutoUpload = async (next: boolean): Promise<void> => {
    if (!api) return
    setAutoUpload(next)
    await api.settings.save({ autoUploadToNotion: next })
  }

  // ── Jira handlers ─────────────────────────────────────────────────
  const loadJiraProjects = async (): Promise<void> => {
    if (!api) return
    try {
      setJiraProjects(await api.jira.projects())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const loadJiraIssueTypes = async (projectKey: string): Promise<void> => {
    if (!api || !projectKey) return
    try {
      setJiraIssueTypes(await api.jira.issueTypes(projectKey))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const connectJira = async (): Promise<void> => {
    if (!api) return
    setJiraBusy(true)
    setError(null)
    setMessage(null)
    try {
      const sub = extractSubdomain(jiraSubdomain)
      const site = sub ? `https://${sub}.atlassian.net` : ''
      await api.settings.save({ jiraSiteUrl: site || null, jiraEmail: jiraEmail.trim() || null })
      if (jiraToken.trim()) await api.secrets.set('jira.token', jiraToken.trim())
      const me = await api.jira.test()
      setJiraConnected(true)
      setJiraUser(me.displayName)
      setJiraToken('')
      setMessage(`Jira 연결됨 — ${me.displayName}`)
      await loadJiraProjects()
      if (jiraProjectKey) await loadJiraIssueTypes(jiraProjectKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setJiraBusy(false)
    }
  }

  const saveJiraProject = async (key: string): Promise<void> => {
    if (!api) return
    setJiraProjectKey(key)
    setJiraIssueType('')
    await api.settings.save({ jiraProjectKey: key || null, jiraIssueType: null })
    setJiraIssueTypes([])
    if (key) await loadJiraIssueTypes(key)
  }

  const saveJiraIssueType = async (name: string): Promise<void> => {
    if (!api) return
    setJiraIssueType(name)
    await api.settings.save({ jiraIssueType: name || null })
    setMessage('Jira 기본 이슈 타입을 저장했습니다.')
  }

  const toggleAutoJira = async (next: boolean): Promise<void> => {
    if (!api) return
    setAutoJira(next)
    await api.settings.save({ autoExportToJira: next })
  }

  const clearJira = async (): Promise<void> => {
    if (!api) return
    await api.secrets.delete('jira.token')
    await api.settings.save({ jiraProjectKey: null, jiraIssueType: null })
    setJiraConnected(false)
    setJiraUser(null)
    setJiraProjects([])
    setJiraIssueTypes([])
    setJiraProjectKey('')
    setJiraIssueType('')
    setMessage('Jira 토큰을 삭제했습니다.')
  }

  return (
    <div className="main">
      <header className="main-header">
        <h1>설정</h1>
      </header>
      <div className="main-content">
        <div style={{ display: 'grid', gap: 24, width: '100%', maxWidth: 1100 }}>
          {message && (
            <Banner color="var(--success)" bg="var(--success-banner-bg)">
              {message}
            </Banner>
          )}
          {error && (
            <Banner color="var(--danger)" bg="var(--danger-soft)">
              {error}
            </Banner>
          )}

          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Notion 연동</h3>
            <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
              <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
                notion.so/my-integrations
              </a>{' '}
              에서 새 Internal Integration을 만들고, 회의록을 모아둘{' '}
              <b>아무 페이지에서나</b> <b>… → Connections → 이 통합</b> 으로 연결한 뒤 토큰을 입력하세요. 매 회의록은 그 페이지의 하위 페이지로 저장됩니다.
            </p>
            {!tokenSaved ? (
              <>
                <label className="label">Integration Token</label>
                <input
                  className="input"
                  type="password"
                  placeholder="secret_..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  disabled={savingToken || !token.trim()}
                  onClick={saveToken}
                >
                  {savingToken ? '저장 중…' : 'Keychain에 저장'}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, marginBottom: 12 }}>
                  <span style={{ color: 'var(--success)' }}>● </span>
                  Keychain에 토큰이 저장되어 있습니다.
                </p>
                <label className="label">회의록 부모 페이지</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="select"
                    value={dbId}
                    onChange={(e) => saveDb(e.target.value)}
                    disabled={loadingDbs}
                  >
                    <option value="">— 선택하지 않음 —</option>
                    {databases.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={loadDatabases} disabled={loadingDbs}>
                    {loadingDbs ? '…' : '↻'}
                  </button>
                </div>
                {databases.length === 0 && !loadingDbs && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    표시되는 페이지가 없으면, Notion에서 부모로 쓸 페이지를 열어{' '}
                    <b>… → Connections</b> 메뉴로 이 Integration을 연결하세요.
                  </p>
                )}

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 18,
                    fontSize: 13,
                    cursor: dbId ? 'pointer' : 'not-allowed',
                    opacity: dbId ? 1 : 0.5
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoUpload}
                    disabled={!dbId}
                    onChange={(e) => toggleAutoUpload(e.target.checked)}
                  />
                  <div style={{ display: 'grid', gap: 2 }}>
                    <span>회의록 작성 후 자동으로 Notion에 업로드</span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      종료 → 전사 → 화자 분리 → 요약 → 부모 페이지의 자식 페이지로 업로드까지 무인 진행. 실패해도 회의록은
                      로컬에 그대로 남고, 상세 화면에서 다시 업로드할 수 있습니다.
                    </span>
                  </div>
                </label>

                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 16, color: 'var(--danger)' }}
                  onClick={clearToken}
                >
                  토큰 삭제
                </button>
              </>
            )}
          </section>

          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Jira 연동</h3>
            <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
              회의록의 <b>액션 아이템</b>을 Jira 이슈로 보냅니다.{' '}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
              >
                id.atlassian.com → API tokens
              </a>{' '}
              에서 토큰을 만들고, 사이트 URL·이메일과 함께 입력하세요.
            </p>

            <label className="label">사이트 주소</label>
            <div className="affix-input">
              <span className="affix">https://</span>
              <input
                type="text"
                placeholder="your-team"
                value={jiraSubdomain}
                onChange={(e) => setJiraSubdomain(extractSubdomain(e.target.value))}
                aria-label="Jira 워크스페이스 이름"
              />
              <span className="affix">.atlassian.net</span>
            </div>
            <label className="label" style={{ marginTop: 12 }}>
              Atlassian 이메일
            </label>
            <input
              className="input"
              type="email"
              placeholder="you@company.com"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
            />
            <label className="label" style={{ marginTop: 12 }}>
              API 토큰 {jiraConnected && <span className="faint">(저장됨 — 변경 시에만 입력)</span>}
            </label>
            <input
              className="input"
              type="password"
              placeholder={jiraConnected ? '••••••••' : 'API 토큰'}
              value={jiraToken}
              onChange={(e) => setJiraToken(e.target.value)}
            />
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={
                jiraBusy ||
                !jiraSubdomain.trim() ||
                !jiraEmail.trim() ||
                (!jiraConnected && !jiraToken.trim())
              }
              onClick={connectJira}
            >
              {jiraBusy ? '연결 중…' : jiraConnected ? '다시 연결 / 테스트' : '연결 & 테스트'}
            </button>

            {jiraConnected && (
              <>
                <p style={{ fontSize: 13, margin: '14px 0 12px' }}>
                  <span style={{ color: 'var(--success)' }}>● </span>
                  연결됨{jiraUser ? ` — ${jiraUser}` : ''}
                </p>

                <label className="label">기본 프로젝트</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="select"
                    value={jiraProjectKey}
                    onChange={(e) => saveJiraProject(e.target.value)}
                  >
                    <option value="">— 선택하지 않음 —</option>
                    {jiraProjects.map((p) => (
                      <option key={p.id} value={p.key}>
                        {p.name} ({p.key})
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={loadJiraProjects}>
                    ↻
                  </button>
                </div>

                {jiraProjectKey && (
                  <>
                    <label className="label" style={{ marginTop: 12 }}>
                      이슈 타입
                    </label>
                    <select
                      className="select"
                      value={jiraIssueType}
                      onChange={(e) => saveJiraIssueType(e.target.value)}
                    >
                      <option value="">— 선택 (기본 Task) —</option>
                      {jiraIssueTypes.map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 18,
                    fontSize: 13,
                    cursor: jiraProjectKey ? 'pointer' : 'not-allowed',
                    opacity: jiraProjectKey ? 1 : 0.5
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoJira}
                    disabled={!jiraProjectKey}
                    onChange={(e) => toggleAutoJira(e.target.checked)}
                  />
                  <div style={{ display: 'grid', gap: 2 }}>
                    <span>회의록 작성 후 자동으로 Jira에 액션 아이템 전송</span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      종료 → 전사 → 요약 후, 액션 아이템을 위 프로젝트에 이슈로 자동 생성합니다.
                      실패해도 회의록은 로컬에 그대로 남고, 상세 화면의 <b>Jira로 보내기</b> 로 다시
                      보낼 수 있습니다.
                    </span>
                  </div>
                </label>

                <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
                  담당자는 이름이 정확히 한 명과 매칭될 때만 배정되고, 기한은 <code>YYYY-MM-DD</code>
                  형식만 반영됩니다.
                </p>

                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 14, color: 'var(--danger)' }}
                  onClick={clearJira}
                >
                  Jira 연결 해제
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function Banner({
  children,
  color,
  bg
}: {
  children: React.ReactNode
  color: string
  bg: string
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius)',
        background: bg,
        color,
        fontSize: 13
      }}
    >
      {children}
    </div>
  )
}
