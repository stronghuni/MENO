import { useEffect, useState } from 'react'
import type { NotionTarget } from '../../../shared/types'
import { getApi } from '../lib/api'

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

  useEffect(() => {
    if (!api) return
    void (async (): Promise<void> => {
      const [has, settings] = await Promise.all([
        api.secrets.has('notion.token'),
        api.settings.load()
      ])
      setTokenSaved(has)
      setDbId(settings.notionParentId ?? '')
      setAutoUpload(settings.autoUploadToNotion ?? true)
      if (has) void loadDatabases()
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
