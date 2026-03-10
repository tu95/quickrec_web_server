import crypto from 'crypto'
import { readConfigForUser } from './config-store'
import { requireUserAuth } from './user-auth'
import { getCookieSecureSuffix } from './cookie-security'

const SITE_COOKIE_NAME = 'zr_site_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7
const DEFAULT_SITE_PASSWORD = 'H*ZM7VwhhepPVhwP*HmC83LzWXn9o8'
const DEFAULT_READONLY_SITE_PASSWORD = 'test20260226'

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase()
}

function getAdminEmailSet() {
  const raw = String(process.env.ADMIN_EMAILS || '').trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map(item => normalizeEmail(item))
      .filter(Boolean)
  )
}

export function isAdminUser(user) {
  const email = normalizeEmail(user?.email)
  if (!email) return false
  const admins = getAdminEmailSet()
  return admins.has(email)
}

function base64UrlEncode(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(input) {
  const padded = `${input}`.replace(/-/g, '+').replace(/_/g, '/')
  const remain = padded.length % 4
  const withPadding = remain === 0 ? padded : padded + '='.repeat(4 - remain)
  return Buffer.from(withPadding, 'base64').toString('utf8')
}

function signPayload(payload, key) {
  return crypto
    .createHmac('sha256', key)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function parseCookiesFromHeader(cookieHeader) {
  const text = String(cookieHeader || '')
  const result = {}
  for (const part of text.split(';')) {
    const seg = String(part || '').trim()
    if (!seg) continue
    const idx = seg.indexOf('=')
    if (idx < 0) continue
    const key = seg.slice(0, idx).trim()
    const value = seg.slice(idx + 1).trim()
    result[key] = value
  }
  return result
}

export function buildSiteSessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${SITE_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${getCookieSecureSuffix()}; Max-Age=${maxAge}`
}

export function buildClearSiteSessionCookie() {
  return `${SITE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${getCookieSecureSuffix()}; Max-Age=0`
}

export function createSiteToken(key, role = 'admin') {
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('hex'),
    role: String(role || 'admin')
  })
  const encodedPayload = base64UrlEncode(payload)
  const signature = signPayload(encodedPayload, key)
  return `${encodedPayload}.${signature}`
}

function verifySiteToken(token, key) {
  if (!token || !key) return null
  const parts = String(token).split('.')
  if (parts.length !== 2) return null
  const payloadEncoded = parts[0]
  const signature = parts[1]
  const expected = signPayload(payloadEncoded, key)
  if (signature.length !== expected.length) {
    return null
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null
  }
  try {
    const payloadText = base64UrlDecode(payloadEncoded)
    const payload = JSON.parse(payloadText)
    const exp = Number(payload?.exp || 0)
    if (!(Number.isFinite(exp) && exp > Date.now())) {
      return null
    }
    const role = String(payload?.role || 'admin')
    return {
      exp,
      role: role === 'readonly' ? 'readonly' : 'admin'
    }
  } catch {
    return null
  }
}

export async function getSitePassword(config) {
  const fromConfig = String(config?.access?.sitePassword || config?.access?.settingsPageKey || '').trim()
  const fromEnv = String(process.env.SITE_ACCESS_PASSWORD || '').trim()
  return fromConfig || fromEnv || DEFAULT_SITE_PASSWORD
}

export async function getReadonlySitePassword(config) {
  const fromConfig = String(config?.access?.readonlySitePassword || '').trim()
  const fromEnv = String(process.env.SITE_ACCESS_READONLY_PASSWORD || '').trim()
  return fromConfig || fromEnv || DEFAULT_READONLY_SITE_PASSWORD
}

export async function requireSiteAuth(request) {
  const userAuth = await requireUserAuth(request)
  if (!userAuth.ok) {
    return {
      ok: false,
      status: userAuth.status || 401,
      error: String(userAuth.error || '未授权，请先登录网站')
    }
  }
  let config
  try {
    config = await readConfigForUser(userAuth.user?.id)
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: `读取用户配置失败，请稍后重试（${String(error?.message || error)}）`
    }
  }
  return {
    ok: true,
    config,
    user: userAuth.user,
    role: isAdminUser(userAuth.user) ? 'admin' : 'user',
    readOnly: !isAdminUser(userAuth.user)
  }
}

export async function requireAdminAuth(request) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) return auth
  if (auth.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: '仅管理员可访问'
    }
  }
  return auth
}

// Backward compatibility
export const buildAdminSessionCookie = buildSiteSessionCookie
export const buildClearAdminSessionCookie = buildClearSiteSessionCookie
export const createAdminToken = createSiteToken
export const SITE_AUTH_COOKIE_NAME = SITE_COOKIE_NAME
