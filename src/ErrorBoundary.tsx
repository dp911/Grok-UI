import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, ShieldAlert } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Grok UI render failure', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal-screen">
        <div className="fatal-mark"><ShieldAlert size={24} /><i /></div>
        <span className="kicker">LOCAL INTERFACE / INTERRUPTED</span>
        <h1>The data is safe.<br /><em>The view needs a reset.</em></h1>
        <p>
          Grok UI encountered a browser-side rendering failure. No session or
          workspace data was modified.
        </p>
        <button className="launch-button" onClick={() => window.location.reload()}>
          <span>RELOAD LOCAL DASHBOARD</span>
          <RefreshCw size={16} />
        </button>
      </main>
    )
  }
}
