import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PreviewSupervisor, type PreviewSnapshot } from './preview-supervisor.js'

const directories: string[] = []
const supervisors: PreviewSupervisor[] = []

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()))
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ))
})

async function temporary(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  directories.push(directory)
  return directory
}

async function waitFor(
  supervisor: PreviewSupervisor,
  sessionId: string,
  cwd: string,
  status: PreviewSnapshot['status'],
): Promise<PreviewSnapshot> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const snapshot = await supervisor.inspect(sessionId, cwd)
    if (snapshot.status === status) return snapshot
    if (snapshot.status === 'failed') throw new Error(snapshot.error)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Preview did not reach ${status}.`)
}

describe('PreviewSupervisor', () => {
  it('detects framework-aware loopback commands without starting code', async () => {
    const cwd = await temporary('grok-ui-preview-detect-')
    await Promise.all([
      fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
        scripts: { dev: 'vite' },
        devDependencies: { vite: '^8.0.0' },
      })),
      fs.writeFile(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'),
    ])
    const supervisor = new PreviewSupervisor()
    supervisors.push(supervisor)

    const snapshot = await supervisor.inspect('preview-detect', cwd)

    expect(snapshot).toMatchObject({
      available: true,
      status: 'idle',
      command: 'pnpm',
      port: 0,
      url: '',
    })
    expect(snapshot.displayCommand).toContain('--host 127.0.0.1 --port <port>')
  })

  it('starts, observes, and stops a session-scoped loopback preview', async () => {
    const cwd = await temporary('grok-ui-preview-run-')
    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
      scripts: { dev: 'node preview-server.mjs' },
    }))
    await fs.writeFile(path.join(cwd, 'preview-server.mjs'), `
      import http from 'node:http'
      const host = process.env.HOST
      const port = Number(process.env.PORT)
      http.createServer((_request, response) => {
        response.end('preview-ready')
      }).listen(port, host, () => console.log('preview listening on ' + host + ':' + port))
    `)
    const supervisor = new PreviewSupervisor(8_000, 50)
    supervisors.push(supervisor)

    const starting = await supervisor.start('preview-run', cwd)
    expect(starting).toMatchObject({
      available: true,
      status: 'starting',
      command: 'npm',
    })
    expect(starting.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const running = await waitFor(supervisor, 'preview-run', cwd, 'running')
    expect(await (await fetch(running.url)).text()).toBe('preview-ready')
    expect(running.logs.join('\n')).toContain('preview listening on 127.0.0.1')

    const stopped = await supervisor.stop('preview-run')
    expect(stopped.status).toBe('stopped')
    await expect(fetch(running.url)).rejects.toThrow()
  })

  it('does not invent a command for workspaces without a supported script', async () => {
    const cwd = await temporary('grok-ui-preview-missing-')
    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
      scripts: { build: 'vite build' },
    }))
    const supervisor = new PreviewSupervisor()
    supervisors.push(supervisor)

    const snapshot = await supervisor.inspect('preview-missing', cwd)

    expect(snapshot.available).toBe(false)
    expect(snapshot.error).toContain('dev or start script')
    await expect(supervisor.start('preview-missing', cwd)).rejects.toThrow('dev or start script')
  })
})
