import { describe, expect, it } from 'vitest'
import { inspectSetup, type SetupCommandRunner } from './setup-diagnostics.js'

function runner(results: Record<string, { ok: boolean; output?: string }>): SetupCommandRunner {
  return async (_executable, args) => {
    const result = results[args.join(' ')] || { ok: false }
    return { ok: result.ok, output: result.output || '' }
  }
}

describe('setup diagnostics', () => {
  it('reports a fully ready local environment without exposing paths', async () => {
    const status = await inspectSetup({
      nodeVersion: '22.12.0',
      stateExists: true,
      run: runner({
        version: { ok: true, output: 'grok 0.2.111 [stable]' },
        models: { ok: true },
      }),
    })

    expect(status.ready).toBe(true)
    expect(status.checks.every((check) => check.state === 'ready')).toBe(true)
    expect(JSON.stringify(status)).not.toContain('/Users/')
  })

  it('turns a missing CLI into actionable, non-blocking guidance', async () => {
    const status = await inspectSetup({
      nodeVersion: '22.12.0',
      stateExists: false,
      run: runner({}),
    })

    expect(status.ready).toBe(false)
    expect(status.checks.find((check) => check.id === 'cli')).toMatchObject({
      state: 'action',
      command: 'grok version',
    })
    expect(status.checks.find((check) => check.id === 'auth')).toMatchObject({
      state: 'action',
      command: 'grok login',
    })
  })

  it('distinguishes authentication failure from CLI installation failure', async () => {
    const status = await inspectSetup({
      nodeVersion: '22.12.0',
      stateExists: true,
      run: runner({
        version: { ok: true, output: 'grok test' },
        models: { ok: false },
      }),
    })

    expect(status.checks.find((check) => check.id === 'cli')?.state).toBe('ready')
    expect(status.checks.find((check) => check.id === 'auth')).toMatchObject({
      state: 'action',
      detail: 'Authentication is required.',
    })
  })
})
