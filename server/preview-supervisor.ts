import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export type PreviewStatus = 'idle' | 'starting' | 'running' | 'failed' | 'stopped'

export interface PreviewSnapshot {
  sessionId: string
  cwd: string
  available: boolean
  status: PreviewStatus
  command: string
  args: string[]
  displayCommand: string
  port: number
  url: string
  startedAt: string
  updatedAt: string
  error: string
  logs: string[]
}

interface PreviewRecipe {
  command: string
  args: (port: number) => string[]
  displayCommand: string
}

interface PreviewEntry {
  snapshot: PreviewSnapshot
  process: ChildProcessWithoutNullStreams | null
  stopping: boolean
}

const MAX_PACKAGE_BYTES = 256 * 1024
const MAX_LOG_LINES = 200
const MAX_LOG_LINE_LENGTH = 2_000
const SENSITIVE_ENV_KEY = /(?:^|_)(?:GROK|XAI)(?:_|$)|TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY/i

function now(): string {
  return new Date().toISOString()
}

function cleanLogLine(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, MAX_LOG_LINE_LENGTH)
}

function previewEnvironment(port: number): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !SENSITIVE_ENV_KEY.test(key)),
  )

  return {
    ...inherited,
    BROWSER: 'none',
    HOST: '127.0.0.1',
    NO_COLOR: '1',
    PORT: String(port),
  }
}

function packageManager(files: Set<string>): string {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun'
  return 'npm'
}

function runArgs(manager: string, script: string, extra: string[]): string[] {
  if (manager === 'yarn') return [script, ...extra]
  return ['run', script, ...extra]
}

async function previewRecipe(cwd: string): Promise<PreviewRecipe | null> {
  const packagePath = path.join(cwd, 'package.json')
  let stat
  try {
    stat = await fs.stat(packagePath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > MAX_PACKAGE_BYTES) return null

  let manifest: {
    scripts?: Record<string, unknown>
    dependencies?: Record<string, unknown>
    devDependencies?: Record<string, unknown>
  }
  try {
    manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  } catch {
    return null
  }

  const scripts = manifest.scripts || {}
  const script = typeof scripts.dev === 'string'
    ? 'dev'
    : typeof scripts.start === 'string'
      ? 'start'
      : ''
  if (!script) return null

  const files = new Set(await fs.readdir(cwd).catch(() => []))
  const manager = packageManager(files)
  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  }
  const has = (name: string) => Object.hasOwn(dependencies, name)

  if (script === 'dev' && (has('vite') || has('astro') || has('@sveltejs/kit'))) {
    return {
      command: manager,
      args: (port) => runArgs(manager, script, ['--', '--host', '127.0.0.1', '--port', String(port)]),
      displayCommand: `${manager} ${runArgs(manager, script, ['--', '--host', '127.0.0.1', '--port', '<port>']).join(' ')}`,
    }
  }

  if (script === 'dev' && has('next')) {
    return {
      command: manager,
      args: (port) => runArgs(manager, script, ['--', '--hostname', '127.0.0.1', '--port', String(port)]),
      displayCommand: `${manager} ${runArgs(manager, script, ['--', '--hostname', '127.0.0.1', '--port', '<port>']).join(' ')}`,
    }
  }

  return {
    command: manager,
    args: () => runArgs(manager, script, []),
    displayCommand: `${manager} ${runArgs(manager, script, []).join(' ')} (HOST=127.0.0.1, PORT=<port>)`,
  }
}

async function openPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

export class PreviewSupervisor {
  private readonly entries = new Map<string, PreviewEntry>()

  constructor(
    private readonly startupTimeoutMs = 25_000,
    private readonly pollIntervalMs = 200,
  ) {}

  async inspect(sessionId: string, cwd: string): Promise<PreviewSnapshot> {
    const existing = this.entries.get(sessionId)
    if (existing && path.resolve(existing.snapshot.cwd) === path.resolve(cwd)) {
      return this.copy(existing.snapshot)
    }
    const recipe = await previewRecipe(cwd)
    const timestamp = now()
    return {
      sessionId,
      cwd,
      available: Boolean(recipe),
      status: 'idle',
      command: recipe?.command || '',
      args: [],
      displayCommand: recipe?.displayCommand || '',
      port: 0,
      url: '',
      startedAt: '',
      updatedAt: timestamp,
      error: recipe ? '' : 'No supported package.json dev or start script was found.',
      logs: [],
    }
  }

  async start(sessionId: string, cwd: string): Promise<PreviewSnapshot> {
    const existing = this.entries.get(sessionId)
    if (existing && ['starting', 'running'].includes(existing.snapshot.status)) {
      return this.copy(existing.snapshot)
    }

    const recipe = await previewRecipe(cwd)
    if (!recipe) throw new Error('No supported package.json dev or start script was found.')

    const port = await openPort()
    const args = recipe.args(port)
    const timestamp = now()
    const snapshot: PreviewSnapshot = {
      sessionId,
      cwd,
      available: true,
      status: 'starting',
      command: recipe.command,
      args,
      displayCommand: `${recipe.command} ${args.join(' ')}`,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: timestamp,
      updatedAt: timestamp,
      error: '',
      logs: [],
    }
    const child = spawn(recipe.command, args, {
      cwd,
      env: previewEnvironment(port),
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const entry: PreviewEntry = { snapshot, process: child, stopping: false }
    this.entries.set(sessionId, entry)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.appendLogs(entry, chunk))
    child.stderr.on('data', (chunk: string) => this.appendLogs(entry, chunk))
    child.once('error', (error) => {
      if (this.entries.get(sessionId) !== entry) return
      entry.snapshot = {
        ...entry.snapshot,
        status: 'failed',
        updatedAt: now(),
        error: error.message,
      }
      entry.process = null
    })
    child.once('exit', (code, signal) => {
      if (this.entries.get(sessionId) !== entry) return
      const stopped = entry.stopping
      const existingFailure = entry.snapshot.status === 'failed' ? entry.snapshot.error : ''
      entry.snapshot = {
        ...entry.snapshot,
        status: stopped ? 'stopped' : 'failed',
        updatedAt: now(),
        error: stopped ? '' : existingFailure || `Preview process exited (${signal || code || 'unknown'}).`,
      }
      entry.process = null
    })
    void this.waitUntilReady(entry)
    return this.copy(snapshot)
  }

  async stop(sessionId: string): Promise<PreviewSnapshot> {
    const entry = this.entries.get(sessionId)
    if (!entry) throw new Error('Preview is not running.')
    entry.stopping = true
    const child = entry.process
    if (child?.pid) {
      this.signal(child, 'SIGTERM')
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ])
      if (entry.process?.pid) this.signal(entry.process, 'SIGKILL')
    }
    entry.process = null
    entry.snapshot = {
      ...entry.snapshot,
      status: 'stopped',
      updatedAt: now(),
      error: '',
    }
    return this.copy(entry.snapshot)
  }

  async close(): Promise<void> {
    await Promise.all([...this.entries.keys()].map(async (sessionId) => {
      const entry = this.entries.get(sessionId)
      if (!entry?.process) return
      await this.stop(sessionId).catch(() => undefined)
    }))
  }

  private async waitUntilReady(entry: PreviewEntry): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs
    while (
      Date.now() < deadline
      && entry.process
      && entry.snapshot.status === 'starting'
      && !entry.stopping
    ) {
      try {
        await fetch(entry.snapshot.url, { signal: AbortSignal.timeout(800) })
        if (!entry.process || entry.stopping) return
        entry.snapshot = {
          ...entry.snapshot,
          status: 'running',
          updatedAt: now(),
          error: '',
        }
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs))
      }
    }
    if (!entry.process || entry.stopping || entry.snapshot.status !== 'starting') return
    entry.snapshot = {
      ...entry.snapshot,
      status: 'failed',
      updatedAt: now(),
      error: `Preview did not respond within ${Math.round(this.startupTimeoutMs / 1_000)} seconds.`,
    }
    this.signal(entry.process, 'SIGTERM')
  }

  private appendLogs(entry: PreviewEntry, chunk: string): void {
    const lines = chunk
      .split(/\r?\n/)
      .map(cleanLogLine)
      .filter(Boolean)
    if (!lines.length) return
    entry.snapshot = {
      ...entry.snapshot,
      logs: [...entry.snapshot.logs, ...lines].slice(-MAX_LOG_LINES),
      updatedAt: now(),
    }
  }

  private signal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, signal)
      } else {
        child.kill(signal)
      }
    } catch {
      // The process may have exited between the state check and the signal.
    }
  }

  private copy(snapshot: PreviewSnapshot): PreviewSnapshot {
    return { ...snapshot, args: [...snapshot.args], logs: [...snapshot.logs] }
  }
}
