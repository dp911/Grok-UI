import {
  Bell,
  Bot,
  Check,
  CircleStop,
  Command,
  CornerDownLeft,
  FolderGit2,
  Radio,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  cancelControlSession,
  createControlSession,
  promptControlSession,
  resolveControlPermission,
} from '../api'
import type {
  ControlSnapshot,
  DashboardPayload,
  LiveSnapshot,
} from '../types'

interface ControlViewProps {
  data: DashboardPayload
  live: LiveSnapshot | null
  control: ControlSnapshot | null
  onRefresh: () => Promise<void>
  onOpenSession: (sessionId: string) => void
}

function compact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function uniqueWorkspaces(data: DashboardPayload, live: LiveSnapshot | null): string[] {
  return [...new Set([
    ...(live?.agents.map((agent) => agent.cwd) || []),
    ...data.sessions.map((session) => session.cwd),
  ].filter(Boolean))]
}

export function ControlView({ data, live, control, onRefresh, onOpenSession }: ControlViewProps) {
  const workspaces = useMemo(() => uniqueWorkspaces(data, live), [data, live])
  const resumable = useMemo(() => {
    const seen = new Set<string>()
    return [
      ...(control?.sessions || []).map((session) => ({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
      })),
      ...data.sessions.filter((session) => !session.archived),
    ].filter((session) => {
      if (seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
  }, [control, data.sessions])
  const [mode, setMode] = useState<'new' | 'resume'>('new')
  const [cwd, setCwd] = useState(workspaces[0] || '')
  const [sessionId, setSessionId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('medium')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selectedLane, setSelectedLane] = useState(control?.sessions[0]?.id || '')

  useEffect(() => {
    if (!control?.sessions.length) {
      setSelectedLane('')
      return
    }
    if (!control.sessions.some((session) => session.id === selectedLane)) {
      setSelectedLane(control.sessions[0].id)
    }
  }, [control?.sessions, selectedLane])

  const activeLane = control?.sessions.find((session) => session.id === selectedLane)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!prompt.trim()) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'resume') {
        const selected = resumable.find((session) => session.id === sessionId)
        if (!selected) throw new Error('Choose a session to resume.')
        await promptControlSession(selected.id, { cwd: selected.cwd, prompt })
        setMessage(`Prompt sent to ${selected.title}.`)
      } else {
        await createControlSession({ cwd, prompt, model, reasoningEffort })
        setMessage('New Grok lane launched.')
      }
      setPrompt('')
      await onRefresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Command failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async (id: string) => {
    try {
      await cancelControlSession(id)
      await onRefresh()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Unable to stop the session.')
    }
  }

  const decide = async (permissionId: string, optionId?: string) => {
    try {
      await resolveControlPermission(permissionId, optionId)
      await onRefresh()
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Unable to resolve permission.')
    }
  }

  const chooseSession = (id: string) => {
    setSessionId(id)
    const selected = resumable.find((session) => session.id === id)
    if (selected) setCwd(selected.cwd)
  }

  return (
    <>
      <section className="page-intro command-intro">
        <div className="page-intro-index">02 / 08</div>
        <div className="page-intro-copy">
          <div className="kicker"><Command size={14} /> Command deck</div>
          <h1>Don’t just watch.<br /><em>Run the room.</em></h1>
        </div>
        <p>Launch concurrent Grok agents, resume any conversation, approve sensitive work, and stop a turn without returning to the terminal.</p>
      </section>

      <section className="control-health-strip">
        <div>
          <span className={`status-dot ${control?.connected ? 'is-live' : ''}`} />
          <strong>{control?.connected ? 'ACP CONTROL LINKED' : control?.starting ? 'STARTING CONTROL' : 'CONTROL OFFLINE'}</strong>
          <small>{control?.agentName || 'Grok'} {control?.agentVersion}</small>
        </div>
        <div><span>MANAGED LANES</span><strong>{control?.sessions.length || 0}</strong></div>
        <div className={control?.permissions.length ? 'is-attention' : ''}>
          <span>PENDING APPROVALS</span><strong>{control?.permissions.length || 0}</strong>
        </div>
        <button
          className="text-button"
          onClick={() => void Notification.requestPermission()}
          disabled={!('Notification' in window)}
        >
          <Bell size={14} /> Enable alerts
        </button>
      </section>

      {control?.error && (
        <div className="control-banner is-error"><ShieldAlert size={17} /><span>{control.error}</span></div>
      )}
      {error && <div className="control-banner is-error"><X size={17} /><span>{error}</span></div>}
      {message && <div className="control-banner is-success"><Check size={17} /><span>{message}</span></div>}

      <section className="command-deck-grid section-gap">
        <form className="composer-panel panel-cut" onSubmit={submit}>
          <header>
            <div>
              <span className="panel-index">01</span>
              <h2>Issue a command</h2>
            </div>
            <span className="composer-shortcut">⌘ ↵</span>
          </header>

          <div className="mode-switch" role="tablist" aria-label="Command target">
            <button type="button" className={mode === 'new' ? 'is-active' : ''} onClick={() => setMode('new')}>
              <Sparkles size={15} /> New agent
            </button>
            <button type="button" className={mode === 'resume' ? 'is-active' : ''} onClick={() => setMode('resume')}>
              <Radio size={15} /> Resume session
            </button>
          </div>

          {mode === 'resume' ? (
            <label className="control-field">
              <span>SESSION</span>
              <select value={sessionId} onChange={(event) => chooseSession(event.target.value)} required>
                <option value="">Choose a recorded session…</option>
                {resumable.map((session) => (
                  <option value={session.id} key={session.id}>{session.title} — {session.id.slice(0, 8)}</option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="control-field">
                <span>WORKSPACE</span>
                <input
                  list="grok-workspaces"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  placeholder="/absolute/path/to/project"
                  required
                />
                <datalist id="grok-workspaces">
                  {workspaces.map((workspace) => <option value={workspace} key={workspace} />)}
                </datalist>
              </label>
              <div className="control-field-row">
                <label className="control-field">
                  <span>MODEL <em>optional</em></span>
                  <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Use Grok default" />
                </label>
                <label className="control-field">
                  <span>REASONING</span>
                  <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
                    {['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => <option key={effort}>{effort}</option>)}
                  </select>
                </label>
              </div>
            </>
          )}

          <label className="prompt-field">
            <span>INSTRUCTION</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.form?.requestSubmit()
              }}
              placeholder="What should Grok do next?"
              rows={7}
              maxLength={32_000}
              required
            />
            <small>{compact(prompt.length)} / 32K</small>
          </label>

          <button className="launch-button" disabled={submitting || !control?.connected}>
            <span>{submitting ? 'DISPATCHING' : mode === 'new' ? 'LAUNCH AGENT' : 'SEND PROMPT'}</span>
            <CornerDownLeft size={17} />
          </button>
          <p className="composer-note">Tool executions still pass through Grok’s native permission system. Nothing is silently auto-approved.</p>
        </form>

        <aside className="approval-panel">
          <header>
            <div>
              <span className="panel-index">02</span>
              <h2>Approval queue</h2>
            </div>
            <span className={`approval-count ${control?.permissions.length ? 'has-items' : ''}`}>
              {String(control?.permissions.length || 0).padStart(2, '0')}
            </span>
          </header>
          {control?.permissions.length ? (
            <div className="approval-list">
              {control.permissions.map((permission) => (
                <article className="approval-card" key={permission.id}>
                  <div className="approval-card-head">
                    <ShieldAlert size={18} />
                    <div>
                      <span>{permission.toolKind} / {permission.toolCallId.slice(-8)}</span>
                      <h3>{permission.title}</h3>
                    </div>
                  </div>
                  <div className="approval-options">
                    {permission.options.map((option) => (
                      <button
                        key={option.id}
                        className={option.kind.includes('reject') ? 'is-reject' : ''}
                        onClick={() => void decide(permission.id, option.id)}
                      >
                        {option.kind.includes('reject') ? <X size={14} /> : <Check size={14} />}
                        {option.name}
                      </button>
                    ))}
                    <button className="is-reject" onClick={() => void decide(permission.id)}>
                      <CircleStop size={14} /> Cancel turn
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="approval-empty">
              <div className="approval-radar"><span /><i /></div>
              <strong>No decisions waiting.</strong>
              <p>Permission prompts appear here the moment Grok requests a protected tool.</p>
            </div>
          )}
        </aside>
      </section>

      <section className="managed-lanes section-gap">
        <header>
          <div><span className="panel-index">03</span><h2>Managed lanes</h2></div>
          <span>PARALLEL ACP SESSIONS</span>
        </header>
        {control?.sessions.length ? (
          <div className="lane-grid">
            {control.sessions.map((session, index) => (
              <article className={`lane-card state-${session.state} ${selectedLane === session.id ? 'is-selected' : ''}`} key={session.id}>
                <div className="lane-index">L{String(index + 1).padStart(2, '0')}</div>
                <div className="lane-main">
                  <div className="lane-state"><i /> {session.state}</div>
                  <h3>{session.title}</h3>
                  <p><FolderGit2 size={13} /> {session.cwd}</p>
                </div>
                <div className="lane-telemetry">
                  <div><span>TOKENS</span><strong>{compact(session.totalTokens)}</strong></div>
                  <div><span>COST</span><strong>{session.costAmount ? `${session.costAmount.toFixed(3)} ${session.costCurrency}` : '—'}</strong></div>
                  <div><span>STOP</span><strong>{session.stopReason || '—'}</strong></div>
                </div>
                <div className="lane-actions">
                  {(session.state === 'working' || session.state === 'starting') && (
                    <button className="stop-lane" onClick={() => void cancel(session.id)}>
                      <CircleStop size={15} /> Stop
                    </button>
                  )}
                  <button className="open-lane" onClick={() => setSelectedLane(session.id)}>
                    Open stream
                  </button>
                  <button className="open-lane" onClick={() => onOpenSession(session.id)}>
                    Workbench
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-lanes"><Bot size={22} /><span>Launch the first agent from the command deck.</span></div>
        )}
      </section>

      {activeLane && (
        <section className="managed-stream section-gap">
          <header>
            <div>
              <span className="panel-index">04</span>
              <div><span>MANAGED SESSION STREAM</span><h2>{activeLane.title}</h2></div>
            </div>
            <span>{activeLane.feed.length} EVENTS</span>
          </header>
          <div className="managed-stream-feed" aria-live="polite">
            {activeLane.feed.length ? activeLane.feed.map((item, index) => (
              <article className={`managed-event event-${item.type}`} key={item.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <header>
                    <strong>{item.type}</strong>
                    <em>{item.status}</em>
                    <time>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </header>
                  <p>{item.text || item.title}</p>
                </div>
              </article>
            )) : (
              <div className="stream-empty">Waiting for the first ACP session update.</div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
