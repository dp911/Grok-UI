import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GrokStore } from './grok-store.js'
import { LiveMonitor } from './live-monitor.js'
import { GrokController } from './grok-controller.js'
import { SecurityGate } from './security.js'
import { WorkspaceInspector } from './workspace-inspector.js'

const app = express()
const store = new GrokStore()
const liveMonitor = new LiveMonitor(store)
const controller = new GrokController()
const workspaceInspector = new WorkspaceInspector()
const port = Number(process.env.PORT || 4310)
const host = process.env.HOST || '127.0.0.1'
const security = new SecurityGate(host)
const eventClients = new Set<express.Response>()

function broadcast(event: string, payload: unknown) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  eventClients.forEach((client) => client.write(frame))
}

liveMonitor.on('live', (payload) => broadcast('live', payload))
liveMonitor.on('dashboard', (payload) => broadcast('dashboard', payload))
controller.on('control', (payload) => broadcast('control', payload))

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))
app.use(security.headers)

app.get('/api/health', async (_request, response) => {
  response.json({
    ok: true,
    authRequired: security.authRequired,
    generatedAt: new Date().toISOString(),
  })
})
app.get('/api/auth/status', security.status)
app.post('/api/auth/login', security.login)
app.post('/api/auth/logout', security.logout)
app.use('/api', security.protect)

app.get('/api/dashboard', async (request, response, next) => {
  try {
    response.json(await store.dashboard(request.query.refresh === '1'))
  } catch (error) {
    next(error)
  }
})

app.get('/api/live', (_request, response) => {
  response.json(liveMonitor.snapshot())
})

app.get('/api/control', async (_request, response) => {
  try {
    await controller.start()
  } catch {
    // The snapshot includes the actionable startup error.
  }
  response.json(controller.snapshot())
})

app.post('/api/control/sessions', async (request, response) => {
  try {
    const session = await controller.createSession({
      cwd: typeof request.body?.cwd === 'string' ? request.body.cwd : '',
      prompt: typeof request.body?.prompt === 'string' ? request.body.prompt : '',
      model: typeof request.body?.model === 'string' ? request.body.model : '',
      reasoningEffort: typeof request.body?.reasoningEffort === 'string' ? request.body.reasoningEffort : '',
    })
    response.status(202).json(session)
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create session.' })
  }
})

app.post('/api/control/sessions/:id/prompt', async (request, response) => {
  try {
    const session = await controller.promptSession({
      sessionId: request.params.id,
      cwd: typeof request.body?.cwd === 'string' ? request.body.cwd : '',
      prompt: typeof request.body?.prompt === 'string' ? request.body.prompt : '',
    })
    response.status(202).json(session)
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to send prompt.' })
  }
})

app.post('/api/control/sessions/:id/cancel', async (request, response) => {
  try {
    await controller.cancelSession(request.params.id)
    response.status(202).json({ cancelled: true })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to cancel session.' })
  }
})

app.post('/api/control/permissions/:id', (request, response) => {
  const optionId = typeof request.body?.optionId === 'string' ? request.body.optionId : undefined
  if (!controller.resolvePermission(request.params.id, optionId)) {
    response.status(404).json({ error: 'Permission request is no longer pending.' })
    return
  }
  response.json({ resolved: true })
})

async function workspaceAllowed(cwd: string): Promise<boolean> {
  const resolved = path.resolve(cwd)
  if (resolved === process.cwd()) return true
  const dashboard = await store.dashboard()
  if (dashboard.sessions.some((session) => path.resolve(session.cwd) === resolved)) return true
  return controller.snapshot().sessions.some((session) => path.resolve(session.cwd) === resolved)
}

app.get('/api/workspace', async (request, response) => {
  const cwd = typeof request.query.cwd === 'string' ? request.query.cwd : ''
  if (!cwd || !(await workspaceAllowed(cwd))) {
    response.status(403).json({ error: 'Workspace is not associated with a Grok session.' })
    return
  }
  response.json(await workspaceInspector.snapshot(cwd))
})

app.get('/api/workspace/diff', async (request, response) => {
  const cwd = typeof request.query.cwd === 'string' ? request.query.cwd : ''
  const file = typeof request.query.file === 'string' ? request.query.file : ''
  if (!cwd || !(await workspaceAllowed(cwd))) {
    response.status(403).json({ error: 'Workspace is not associated with a Grok session.' })
    return
  }
  try {
    response.json(await workspaceInspector.diff(cwd, file))
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to read diff.' })
  }
})

app.get('/api/sessions/:id', async (request, response, next) => {
  try {
    const session = await store.session(request.params.id)
    if (!session) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    response.json(session)
  } catch (error) {
    next(error)
  }
})

app.get('/api/events', (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders()
  eventClients.add(response)
  response.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`)
  response.write(`event: live\ndata: ${JSON.stringify(liveMonitor.snapshot())}\n\n`)
  response.write(`event: control\ndata: ${JSON.stringify(controller.snapshot())}\n\n`)
  void store.dashboard().then((payload) => {
    response.write(`event: dashboard\ndata: ${JSON.stringify(payload)}\n\n`)
  })

  const heartbeat = setInterval(() => response.write('event: heartbeat\ndata: {}\n\n'), 20_000)
  request.on('close', () => {
    clearInterval(heartbeat)
    eventClients.delete(response)
  })
})

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staticDir = path.join(root, 'dist')
app.use(express.static(staticDir))
app.get('*splat', (_request, response) => response.sendFile(path.join(staticDir, 'index.html')))

app.use((
  error: unknown,
  _request: express.Request,
  response: express.Response,
  _next: express.NextFunction,
) => {
  console.error(error)
  response.status(500).json({ error: 'Unable to read the local Grok data store.' })
})

await liveMonitor.start()

const server = app.listen(port, host, () => {
  console.log(`Grok UI → http://${host}:${port}`)
  console.log(`Reading local state from ${store.grokHome}`)
  console.log(`Remote authentication ${security.authRequired ? 'enabled' : 'not required on loopback'}`)
})

async function shutdown() {
  server.close()
  await Promise.all([liveMonitor.stop(), controller.stop()])
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
