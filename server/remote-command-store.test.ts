import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RemoteCommandStore, payloadFingerprint } from './remote-command-store.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((item) => fs.rm(item, { recursive: true, force: true }))))

async function store(): Promise<{ store: RemoteCommandStore, dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-ui-commands-'))
  cleanup.push(dir)
  return { store: new RemoteCommandStore(path.join(dir, 'private')), dir }
}
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
const request = (commandId = 'command-1', payload: unknown = { prompt: 'private prompt' }) => ({ commandId, kind: 'message', target: 'session-1', actorFingerprint: 'actor-sha256', expiresAt, payload })

describe('RemoteCommandStore', () => {
  it('executes once, returns its stored result, and never writes payload content', async () => {
    const fixture = await store(); let calls = 0
    expect(await fixture.store.execute(request(), async () => ({ ok: ++calls }))).toEqual({ outcome: 'completed', result: { ok: 1 } })
    expect(await fixture.store.execute(request('command-1', { prompt: 'private prompt' }), async () => ({ ok: ++calls }))).toEqual({ outcome: 'completed', result: { ok: 1 } })
    expect(calls).toBe(1)
    const file = path.join(fixture.dir, 'private', 'remote-commands.json')
    const serialized = await fs.readFile(file, 'utf8')
    expect(serialized).not.toContain('private prompt')
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  })

  it('deduplicates concurrent executions and rejects a reused ID for another command', async () => {
    const fixture = await store(); let calls = 0; let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = fixture.store.execute(request(), async () => { calls++; await gate; return 'done' })
    const second = fixture.store.execute(request(), async () => { calls++; return 'wrong' })
    release()
    expect(await Promise.all([first, second])).toEqual([{ outcome: 'completed', result: 'done' }, { outcome: 'completed', result: 'done' }])
    expect(calls).toBe(1)
    await expect(fixture.store.execute(request('command-1', { prompt: 'changed' }), async () => null)).rejects.toThrow('different command')
    await expect(fixture.store.execute({
      ...request(),
      kind: 'interrupt',
    }, async () => null)).rejects.toThrow('different command')
  })

  it('marks interrupted accepted or executing commands unknown after reload', async () => {
    const fixture = await store()
    const privateDir = path.join(fixture.dir, 'private')
    await fs.mkdir(privateDir, { recursive: true })
    await fs.writeFile(path.join(privateDir, 'remote-commands.json'), JSON.stringify({ version: 1, commands: [{ commandId: 'old', kind: 'message', target: 'session-1', actorFingerprint: 'actor-sha256', payloadFingerprint: payloadFingerprint({ a: 1 }), acceptedAt: '2026-01-01T00:00:00.000Z', expiresAt, updatedAt: '2026-01-01T00:00:00.000Z', outcome: 'executing' }], audit: [] }))
    let calls = 0
    await expect(fixture.store.execute(request('old', { a: 1 }), async () => ++calls)).resolves.toEqual({ outcome: 'unknown' })
    expect(calls).toBe(0)
  })

  it('validates command IDs and records failures without payload in the audit', async () => {
    const fixture = await store()
    await expect(fixture.store.execute(request('../bad'), async () => null)).rejects.toThrow('Invalid commandId')
    await expect(fixture.store.execute(request('failure', { body: 'do not retain' }), async () => { throw new Error('secret provider context') })).resolves.toEqual({ outcome: 'failed', error: 'Remote command failed on the host.' })
    const data = JSON.parse(await fs.readFile(path.join(fixture.dir, 'private', 'remote-commands.json'), 'utf8'))
    expect(data.audit.at(-1)).toMatchObject({ commandId: 'failure', kind: 'message', target: 'session-1', actorFingerprint: 'actor-sha256', outcome: 'failed' })
    expect(JSON.stringify(data.audit)).not.toContain('do not retain')
    expect(JSON.stringify(data)).not.toContain('secret provider context')
  })

  it('fails closed instead of replacing malformed durable evidence', async () => {
    const fixture = await store()
    const privateDir = path.join(fixture.dir, 'private')
    const file = path.join(privateDir, 'remote-commands.json')
    await fs.mkdir(privateDir, { recursive: true })
    await fs.writeFile(file, '{not valid json')
    await expect(fixture.store.execute(request(), async () => null)).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('{not valid json')
  })

  it('rejects a command after its signed delivery window instead of replaying it', async () => {
    const fixture = await store()
    let calls = 0
    await expect(fixture.store.execute({
      ...request('expired'),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }, async () => ++calls)).rejects.toThrow(/expired/i)
    expect(calls).toBe(0)
  })
})
