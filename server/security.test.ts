import express from 'express'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { SecurityGate } from './security.js'

const servers: Array<ReturnType<ReturnType<typeof express>['listen']>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve())),
  ))
})

describe('SecurityGate', () => {
  it('allows a tokenless loopback-only server', () => {
    expect(new SecurityGate('127.0.0.1', '').authRequired).toBe(false)
  })

  it('requires a token before binding beyond loopback', () => {
    expect(() => new SecurityGate('0.0.0.0', '')).toThrow('GROK_UI_TOKEN')
    expect(new SecurityGate('0.0.0.0', 'test-token').authRequired).toBe(true)
  })

  it('exchanges a valid token for a protected same-site session', async () => {
    const gate = new SecurityGate('0.0.0.0', 'correct-token')
    const app = express()
    app.use(express.json())
    app.post('/login', gate.login)
    app.all('/protected', gate.protect, (_request, response) => response.json({ ok: true }))
    const server = app.listen(0, '127.0.0.1')
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`

    expect((await fetch(`${origin}/protected`)).status).toBe(401)
    expect((await fetch(`${origin}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' }),
    })).status).toBe(401)

    const login = await fetch(`${origin}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'correct-token' }),
    })
    const cookie = login.headers.get('set-cookie')?.split(';')[0] || ''
    expect(login.status).toBe(200)
    expect(cookie).toContain('grok_ui_session=')

    expect((await fetch(`${origin}/protected`, { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await fetch(`${origin}/protected`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://attacker.invalid' },
    })).status).toBe(403)
  })
})
