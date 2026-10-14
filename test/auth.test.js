import assert from 'node:assert/strict'
import express from 'express'
import { test } from 'node:test'
import { createAuth } from '../src/auth.js'

test('requires credentials to be configured', () => {
  assert.throws(() => createAuth({ username: '', password: '' }), /must both be configured/)
})

test('protects routes with a login session and revokes it on logout', async (t) => {
  const auth = createAuth({ username: 'tracker-user', password: 'correct horse battery staple' })
  const app = express()
  app.use(express.json())
  app.post('/api/login', auth.login)
  app.use('/api', auth.requireAuth)
  app.get('/api/private', (req, res) => res.json({ success: true }))
  app.post('/api/logout', auth.logout)

  const server = app.listen(0)
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const unauthorized = await fetch(`${baseUrl}/api/private`)
  assert.equal(unauthorized.status, 401)

  const rejectedLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tracker-user', password: 'wrong' }),
  })
  assert.equal(rejectedLogin.status, 401)

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tracker-user', password: 'correct horse battery staple' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  const sessionCookie = cookie.split(';', 1)[0]

  const authorized = await fetch(`${baseUrl}/api/private`, {
    headers: { Cookie: sessionCookie },
  })
  assert.equal(authorized.status, 200)

  const logout = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
  })
  assert.equal(logout.status, 200)

  const revoked = await fetch(`${baseUrl}/api/private`, {
    headers: { Cookie: sessionCookie },
  })
  assert.equal(revoked.status, 401)
})
