import crypto from 'crypto'
import { readConfig } from './config-store'

const SITE_COOKIE_NAME = 'zr_site_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7
const DEFAULT_SITE_PASSWORD = 'H*ZM7VwhhepPVhwP*HmC83LzWXn9o8'

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
  return `${SITE_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export function buildClearSiteSessionCookie() {
  return `${SITE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function createSiteToken(key) {
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('hex')
  })
  const encodedPayload = base64UrlEncode(payload)
  const signature = signPayload(encodedPayload, key)
  return `${encodedPayload}.${signature}`
}

function verifySiteToken(token, key) {
  if (!token || !key) return false
  const parts = String(token).split('.')
  if (parts.length !== 2) return false
  const payloadEncoded = parts[0]
  const signature = parts[1]
  const expected = signPayload(payloadEncoded, key)
  if (signature.length !== expected.length) {
    return false
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false
  }
  try {
    const payloadText = base64UrlDecode(payloadEncoded)
    const payload = JSON.parse(payloadText)
    const exp = Number(payload?.exp || 0)
    return Number.isFinite(exp) && exp > Date.now()
  } catch {
    return false
  }
}

export async function getSitePassword(config) {
  const fromConfig = String(config?.access?.sitePassword || config?.access?.settingsPageKey || '').trim()
  const fromEnv = String(process.env.SITE_ACCESS_PASSWORD || '').trim()
  return fromConfig || fromEnv || DEFAULT_SITE_PASSWORD
}

export async function requireSiteAuth(request) {
  const config = await readConfig()
  const key = await getSitePassword(config)
  if (!key) {
    return {
      ok: false,
      status: 403,
      error: 'sitePassword 未配置，请先在 config.json 设置'
    }
  }
  const cookieMap = parseCookiesFromHeader(request.headers.get('cookie'))
  const token = cookieMap[SITE_COOKIE_NAME]
  if (!verifySiteToken(token, key)) {
    return {
      ok: false,
      status: 401,
      error: '未授权，请先登录网站'
    }
  }
  return { ok: true, config }
}

// Backward compatibility
export const requireAdminAuth = requireSiteAuth
export const buildAdminSessionCookie = buildSiteSessionCookie
export const buildClearAdminSessionCookie = buildClearSiteSessionCookie
export const createAdminToken = createSiteToken
export const SITE_AUTH_COOKIE_NAME = SITE_COOKIE_NAME
