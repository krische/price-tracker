import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'

const SESSION_COOKIE = 'price_tracker_session'
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60

function matchesCredential(actual, expected) {
  if (typeof actual !== 'string') return false

  const actualBuffer = Buffer.from(actual, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (actualBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function getSessionToken(req) {
  const cookie = req.headers.cookie
  if (!cookie) return null

  const sessionCookie = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  return sessionCookie?.slice(SESSION_COOKIE.length + 1) || null
}

export function createAuth({ username, password }) {
  if (!username || !password) {
    throw new Error('AUTH_USERNAME and AUTH_PASSWORD must both be configured')
  }

  const sessions = new Map()
  const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : ''

  function requireAuth(req, res, next) {
    const token = getSessionToken(req)
    const expiresAt = token && sessions.get(token)

    if (!expiresAt || expiresAt <= Date.now()) {
      if (token) sessions.delete(token)
      return res.status(401).json({ error: 'Authentication required' })
    }

    next()
  }

  function login(req, res) {
    const credentials = req.body || {}
    const validUsername = matchesCredential(credentials.username, username)
    const validPassword = matchesCredential(credentials.password, password)
    if (!validUsername || !validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    const now = Date.now()
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token)
    }

    const token = randomBytes(32).toString('base64url')
    sessions.set(token, now + SESSION_DURATION_SECONDS * 1000)
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_SECONDS}${secureCookie}`,
    )
    res.json({ success: true })
  }

  function logout(req, res) {
    const token = getSessionToken(req)
    if (token) sessions.delete(token)
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`,
    )
    res.json({ success: true })
  }

  return { login, logout, requireAuth }
}
