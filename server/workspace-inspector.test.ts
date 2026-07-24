import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceInspector } from './workspace-inspector.js'

const execFileAsync = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ))
})

describe('WorkspaceInspector', () => {
  it('summarizes a dirty repository and returns a bounded file diff', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-ui-git-'))
    cleanup.push(directory)
    await execFileAsync('git', ['init', directory])
    await execFileAsync('git', ['-C', directory, 'config', 'user.email', 'test@example.com'])
    await execFileAsync('git', ['-C', directory, 'config', 'user.name', 'Grok UI Test'])
    await fs.writeFile(path.join(directory, 'tracked.txt'), 'first\n')
    await execFileAsync('git', ['-C', directory, 'add', 'tracked.txt'])
    await execFileAsync('git', ['-C', directory, 'commit', '-m', 'initial'])
    await fs.writeFile(path.join(directory, 'tracked.txt'), 'first\nsecond\n')
    await fs.writeFile(path.join(directory, 'new.txt'), 'alpha\nbeta\n')

    const inspector = new WorkspaceInspector()
    const snapshot = await inspector.snapshot(directory)
    const trackedDiff = await inspector.diff(directory, 'tracked.txt')
    const newDiff = await inspector.diff(directory, 'new.txt')

    expect(snapshot).toMatchObject({
      repository: true,
      dirty: true,
      additions: 3,
      deletions: 0,
    })
    expect(snapshot.files.map((file) => file.path)).toEqual(['new.txt', 'tracked.txt'])
    expect(trackedDiff.diff).toContain('+second')
    expect(newDiff.diff).toContain('+++ b/new.txt')
    expect(newDiff.truncated).toBe(false)
    await inspector.close()
  })

  it('rejects diff paths outside the repository', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-ui-git-'))
    cleanup.push(directory)
    await execFileAsync('git', ['init', directory])
    const inspector = new WorkspaceInspector()

    await expect(inspector.diff(directory, '../secret.txt')).rejects.toThrow('outside the repository')
    await inspector.close()
  })

  it('emits a debounced live event when the watched worktree changes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-ui-git-watch-'))
    cleanup.push(directory)
    await execFileAsync('git', ['init', directory])
    await fs.writeFile(path.join(directory, 'tracked.txt'), 'first\n')
    await execFileAsync('git', ['-C', directory, 'add', 'tracked.txt'])
    const inspector = new WorkspaceInspector()
    await inspector.snapshot(directory)

    const changed = new Promise<{ root: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Workspace watcher did not emit')), 5_000)
      inspector.once('change', (event) => {
        clearTimeout(timeout)
        resolve(event)
      })
    })
    await fs.writeFile(path.join(directory, 'tracked.txt'), 'first\nsecond\n')

    await expect(changed).resolves.toMatchObject({ root: await fs.realpath(directory) })
    await inspector.close()
  })
})
