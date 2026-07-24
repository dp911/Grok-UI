import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { WorkspaceDiff, WorkspaceFileChange, WorkspaceSnapshot } from './types.js'

const execFileAsync = promisify(execFile)
const MAX_DIFF_BYTES = 240 * 1024

async function git(cwd: string, args: string[], maxBuffer = MAX_DIFF_BYTES): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer,
    timeout: 8_000,
  })
  return result.stdout.trimEnd()
}

function parseNumstat(value: string, staged: boolean): Map<string, WorkspaceFileChange> {
  const files = new Map<string, WorkspaceFileChange>()
  value.split('\n').filter(Boolean).forEach((line) => {
    const [added, removed, ...pathParts] = line.split('\t')
    const filePath = pathParts.join('\t')
    if (!filePath) return
    files.set(filePath, {
      path: filePath,
      status: 'M',
      staged,
      additions: added === '-' ? 0 : Number(added) || 0,
      deletions: removed === '-' ? 0 : Number(removed) || 0,
    })
  })
  return files
}

export class WorkspaceInspector {
  async snapshot(inputCwd: string): Promise<WorkspaceSnapshot> {
    const cwd = path.resolve(inputCwd)
    try {
      const root = await git(cwd, ['rev-parse', '--show-toplevel'])
      const [branch, upstream, status, unstagedRaw, stagedRaw] = await Promise.all([
        git(root, ['branch', '--show-current']).catch(() => ''),
        git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']).catch(() => ''),
        git(root, ['status', '--short', '--untracked-files=all']).catch(() => ''),
        git(root, ['diff', '--numstat']).catch(() => ''),
        git(root, ['diff', '--cached', '--numstat']).catch(() => ''),
      ])
      const divergence = upstream
        ? await git(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).catch(() => '0\t0')
        : '0\t0'
      const [ahead, behind] = divergence.split(/\s+/).map((value) => Number(value) || 0)
      const unstaged = parseNumstat(unstagedRaw, false)
      const staged = parseNumstat(stagedRaw, true)
      const files = new Map<string, WorkspaceFileChange>()
      status.split('\n').filter(Boolean).forEach((line) => {
        const indexStatus = line[0] || ' '
        const worktreeStatus = line[1] || ' '
        const rawPath = line.slice(3)
        const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1)! : rawPath
        const indexStats = staged.get(filePath)
        const worktreeStats = unstaged.get(filePath)
        files.set(filePath, {
          path: filePath,
          status: `${indexStatus}${worktreeStatus}`.trim() || '?',
          staged: indexStatus !== ' ' && indexStatus !== '?',
          additions: (indexStats?.additions || 0) + (worktreeStats?.additions || 0),
          deletions: (indexStats?.deletions || 0) + (worktreeStats?.deletions || 0),
        })
      })
      const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
      await Promise.all(list.map(async (file) => {
        if (!file.status.includes('?')) return
        try {
          const contents = await fs.readFile(path.join(root, file.path))
          if (contents.length <= MAX_DIFF_BYTES && !contents.includes(0)) {
            const text = contents.toString('utf8').replace(/\n$/, '')
            file.additions = text ? text.split('\n').length : 0
          }
        } catch {
          // File changed between status and inspection.
        }
      }))
      return {
        cwd,
        repository: true,
        root,
        branch: branch || 'detached',
        upstream,
        ahead,
        behind,
        dirty: list.length > 0,
        files: list,
        additions: list.reduce((sum, file) => sum + file.additions, 0),
        deletions: list.reduce((sum, file) => sum + file.deletions, 0),
        error: '',
      }
    } catch {
      return {
        cwd,
        repository: false,
        root: '',
        branch: '',
        upstream: '',
        ahead: 0,
        behind: 0,
        dirty: false,
        files: [],
        additions: 0,
        deletions: 0,
        error: 'This workspace is not a Git repository.',
      }
    }
  }

  async diff(inputCwd: string, inputPath: string): Promise<WorkspaceDiff> {
    const snapshot = await this.snapshot(inputCwd)
    if (!snapshot.repository) throw new Error(snapshot.error)
    const requested = inputPath.replaceAll('\\', '/')
    const absolute = path.resolve(snapshot.root, requested)
    const relative = path.relative(snapshot.root, absolute)
    if (!requested || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('File path is outside the repository.')
    }
    let diff = await git(snapshot.root, ['diff', 'HEAD', '--', relative], MAX_DIFF_BYTES)
      .catch(() => '')
    if (!diff) {
      const status = snapshot.files.find((file) => file.path === relative)?.status || ''
      if (status.includes('?')) {
        const contents = await fs.readFile(absolute)
        if (contents.includes(0)) diff = 'Binary or unsupported untracked file.'
        else diff = `--- /dev/null\n+++ b/${relative}\n${contents.toString('utf8')}`
      }
    }
    const bytes = Buffer.byteLength(diff)
    const truncated = bytes > MAX_DIFF_BYTES
    if (truncated) diff = Buffer.from(diff).subarray(0, MAX_DIFF_BYTES).toString('utf8')
    return { cwd: snapshot.root, path: relative, diff, truncated }
  }
}
