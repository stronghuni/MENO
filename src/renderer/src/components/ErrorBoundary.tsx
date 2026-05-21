import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level error fence. Without this any throw inside a route unmounts the
 * whole tree (we hit this exact failure during early QA in the Library
 * route). The fallback offers a manual reset and a way to reload the
 * renderer instead of leaving the user staring at a blank window.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div
          style={{
            padding: 32,
            maxWidth: 560,
            margin: '40px auto',
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>화면을 표시하지 못했습니다</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            예상치 못한 오류가 발생했습니다. 다시 시도해도 같은 문제가 반복되면 앱을 재시작해 주세요.
          </p>
          <pre
            style={{
              background: 'var(--bg-sunk)',
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              overflow: 'auto',
              marginBottom: 16,
              whiteSpace: 'pre-wrap'
            }}
          >
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={this.reset}>
              다시 시도
            </button>
            <button className="btn" onClick={() => location.reload()}>
              새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
