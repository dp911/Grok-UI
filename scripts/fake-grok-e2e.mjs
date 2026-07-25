#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const args = process.argv.slice(2)
const readyMarker = path.join(process.env.GROK_HOME || '', 'e2e-cli-ready')
const setupMode = existsSync(readyMarker) ? readFileSync(readyMarker, 'utf8').trim() : 'missing'

if (args[0] === 'version') {
  if (setupMode === 'missing') process.exit(1)
  console.log('Grok Build e2e')
  process.exit(0)
}

if (args[0] === 'models') {
  if (setupMode !== 'ready') process.exit(1)
  console.log('grok-e2e')
  process.exit(0)
}

if (args[0] !== 'agent') {
  console.error('Unsupported e2e command.')
  process.exit(1)
}

const sessions = new Set()
const cancelledSessions = new Set()
const cancelWaiters = new Map()
const ignoredCancellationSessions = new Set()
let sequence = 0

function promptText(prompt) {
  return prompt
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function waitForCancellation(sessionId) {
  if (cancelledSessions.has(sessionId)) return Promise.resolve()
  return new Promise((resolve) => cancelWaiters.set(sessionId, resolve))
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
)

const agent = acp.agent({ name: 'grok-e2e' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
    agentInfo: {
      name: 'grok-e2e',
      title: 'Grok E2E Agent',
      version: '0.0.1',
    },
  }))
  .onRequest(acp.methods.agent.session.new, () => {
    sequence += 1
    const sessionId = `managed-e2e-${sequence}`
    sessions.add(sessionId)
    return { sessionId }
  })
  .onRequest(acp.methods.agent.session.load, ({ params }) => {
    sessions.add(params.sessionId)
    return {}
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (!sessions.has(params.sessionId)) throw new Error('Unknown e2e session.')
    const instruction = promptText(params.prompt)
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'E2E agent received the command.' },
      },
    })
    if (instruction.includes('long-running cancellation') || instruction.includes('ignored cancellation')) {
      if (instruction.includes('ignored cancellation')) ignoredCancellationSessions.add(params.sessionId)
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'long-running-tool',
          title: 'Long-running cancellation fixture',
          kind: 'execute',
          status: 'in_progress',
          locations: [],
          rawInput: {},
        },
      })
      await waitForCancellation(params.sessionId)
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'long-running-tool',
          title: 'Long-running cancellation fixture',
          status: 'failed',
        },
      })
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Cancellation confirmed. No further tool work executed.' },
        },
      })
      return { stopReason: 'cancelled' }
    }
    const decision = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: 'e2e-tool',
        title: 'Write the verified fixture',
        kind: 'edit',
        status: 'pending',
        locations: [],
        rawInput: {},
      },
      options: [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    })
    const cancelled = decision.outcome.outcome === 'cancelled'
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'e2e-tool',
        title: 'Write the verified fixture',
        status: cancelled ? 'failed' : 'completed',
      },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: decision.outcome.outcome === 'selected'
            ? 'Permission approved and command completed.'
            : cancelled
              ? 'Cancellation confirmed while permission was pending.'
              : 'Permission declined.',
        },
      },
    })
    if (cancelled) return { stopReason: 'cancelled' }
    return {
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    }
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    cancelledSessions.add(params.sessionId)
    if (ignoredCancellationSessions.has(params.sessionId)) return
    cancelWaiters.get(params.sessionId)?.()
    cancelWaiters.delete(params.sessionId)
  })

agent.connect(stream)
