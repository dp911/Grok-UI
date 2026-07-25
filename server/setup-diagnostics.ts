import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SetupCheck, SetupStatus } from './types.js'

const execute = promisify(execFile)

export interface CommandResult {
  ok: boolean
  output: string
}

export type SetupCommandRunner = (
  executable: string,
  args: string[],
  timeout: number,
) => Promise<CommandResult>

interface SetupDiagnosticOptions {
  grokBin?: string
  grokHome?: string
  nodeVersion?: string
  stateExists?: boolean
  run?: SetupCommandRunner
}

async function runCommand(executable: string, args: string[], timeout: number): Promise<CommandResult> {
  try {
    const result = await execute(executable, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    })
    return {
      ok: true,
      output: String(result.stdout || result.stderr || '').trim(),
    }
  } catch {
    return { ok: false, output: '' }
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0].trim().slice(0, 120)
}

export async function inspectSetup(options: SetupDiagnosticOptions = {}): Promise<SetupStatus> {
  const grokBin = options.grokBin || process.env.GROK_BIN || 'grok'
  const grokHome = options.grokHome || process.env.GROK_HOME || path.join(os.homedir(), '.grok')
  const nodeVersion = options.nodeVersion || process.versions.node
  const stateExists = options.stateExists ?? existsSync(grokHome)
  const run = options.run || runCommand
  const nodeMajor = Number(nodeVersion.split('.')[0])
  const nodeReady = nodeMajor >= 22

  const cli = await run(grokBin, ['version'], 5_000)
  const auth = cli.ok
    ? await run(grokBin, ['models'], 10_000)
    : { ok: false, output: '' }

  const checks: SetupCheck[] = [
    {
      id: 'node',
      label: 'Node runtime',
      state: nodeReady ? 'ready' : 'action',
      detail: nodeReady ? `Node ${nodeVersion} meets the v22+ requirement.` : 'Install Node.js 22 or newer.',
      command: 'node --version',
    },
    {
      id: 'cli',
      label: 'Grok CLI',
      state: cli.ok ? 'ready' : 'action',
      detail: cli.ok ? firstLine(cli.output) || 'Grok CLI detected.' : 'Grok CLI is missing or cannot run.',
      command: 'grok version',
    },
    {
      id: 'auth',
      label: 'Grok account',
      state: auth.ok ? 'ready' : 'action',
      detail: auth.ok
        ? 'Model access confirmed.'
        : cli.ok ? 'Authentication is required.' : 'Available after the Grok CLI is installed.',
      command: 'grok login',
    },
    {
      id: 'state',
      label: 'Local state',
      state: stateExists ? 'ready' : 'action',
      detail: stateExists ? 'Local Grok state detected.' : 'Created automatically by the first Grok session.',
      command: 'grok',
    },
  ]

  return {
    generatedAt: new Date().toISOString(),
    ready: nodeReady && cli.ok && auth.ok,
    checks,
  }
}
