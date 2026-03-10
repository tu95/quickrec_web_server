import crypto from 'crypto'
import {
  createSupabaseAnonClient,
  getSupabaseAnonConfigError,
  getSupabaseAnonKey,
  getSupabaseUrl
} from './supabase-client'
import { getCookieSecureSuffix } from './cookie-security'

export const USER_ACCESS_COOKIE = 'zr_user_access_token'
export const USER_REFRESH_COOKIE = 'zr_user_refresh_token'

function getUserCookieTtlSec() {
  const raw = String(process.env.USER_SESSION_TTL_SEC || '').trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 60 * 60 * 24
  return Math.max(600, Math.min(Math.floor(parsed), 60 * 60 * 24 * 30))
}

function normalizeAuthErrorMessage(raw) {
  const text = String(raw || '').trim()
  if (!text) return '登录已失效，请重新登录'
  const lowered = text.toLowerCase()
  if (
    lowered.includes('jwt') ||
    lowered.includes('token is expired') ||
    lowered.includes('expired') ||
    lowered.includes('invalid token') ||
    lowered.includes('signature')
  ) {
    return '登录已失效，请重新登录'
  }
  if (lowered.includes('session') || lowered.includes('auth')) {
    return '登录已失效，请重新登录'
  }
  return text
}

function readIntEnv(name, fallback, min, max) {
  const raw = String(process.env[name] || '').trim()
  const parsed = raw ? Number(raw) : Number(fallback)
  let value = Number.isFinite(parsed) ? Math.floor(parsed) : Number(fallback)
  if (Number.isFinite(min)) value = Math.max(value, Number(min))
  if (Number.isFinite(max)) value = Math.min(value, Number(max))
  return value
}

function getAuthNetworkTimeoutMs() {
  return readIntEnv('SUPABASE_AUTH_TIMEOUT_MS', 3200, 1000, 15000)
}

function getAuthRetryMax() {
  return readIntEnv('SUPABASE_AUTH_RETRY_MAX', 2, 1, 5)
}

function getAuthRetryDelayMs() {
  return readIntEnv('SUPABASE_AUTH_RETRY_DELAY_MS', 180, 50, 3000)
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}

function normalizeErrorText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    return String(
      value?.message ||
      value?.error_description ||
      value?.error ||
      value?.name ||
      ''
    )
  }
  return String(value)
}

function isNetworkLikeErrorText(raw) {
  const text = String(raw || '').toLowerCase()
  if (!text) return false
  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('eai_again') ||
    text.includes('connect timeout') ||
    text.includes('socket disconnected') ||
    text.includes('tls') ||
    text.includes('network') ||
    text.includes('und_err')
  )
}

async function requestAuthUser(accessToken, timeoutMs) {
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  const token = String(accessToken || '').trim()
  if (!url || !anonKey || !token) {
    return {
      ok: false,
      type: 'invalid',
      error: '登录已失效，请重新登录'
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    try {
      controller.abort()
    } catch {}
  }, timeoutMs)

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      },
      cache: 'no-store',
      signal: controller.signal
    })
    const payload = await response.json().catch(() => null)
    if (response.ok) {
      const user = payload && typeof payload === 'object'
        ? (payload.user || payload)
        : null
      if (user && user.id) {
        return { ok: true, user }
      }
      return { ok: false, type: 'invalid', error: '登录已失效，请重新登录' }
    }
    const errorText = normalizeErrorText(payload?.message || payload?.error_description || payload?.error)
    if (response.status >= 500 || response.status === 429) {
      return {
        ok: false,
        type: 'network',
        error: errorText || `Supabase Auth HTTP ${response.status}`
      }
    }
    return {
      ok: false,
      type: 'invalid',
      error: errorText || `Supabase Auth HTTP ${response.status}`
    }
  } catch (error) {
    const text = normalizeErrorText(error)
    return {
      ok: false,
      type: isNetworkLikeErrorText(text) ? 'network' : 'invalid',
      error: text || 'fetch failed'
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function getAuthUserWithRetry(accessToken) {
  const timeoutMs = getAuthNetworkTimeoutMs()
  const retryMax = getAuthRetryMax()
  const retryDelayMs = getAuthRetryDelayMs()
  let last = { ok: false, type: 'invalid', error: '登录已失效，请重新登录' }

  for (let i = 0; i < retryMax; i += 1) {
    const result = await requestAuthUser(accessToken, timeoutMs)
    last = result
    if (result.ok) return result
    if (result.type !== 'network') return result
    if (i < retryMax - 1) {
      await sleep(retryDelayMs * (i + 1))
    }
  }
  return last
}

function parseCookiesFromHeader(cookieHeader) {
  const text = String(cookieHeader || '')
  const out = {}
  for (const part of text.split(';')) {
    const seg = String(part || '').trim()
    if (!seg) continue
    const idx = seg.indexOf('=')
    if (idx <= 0) continue
    const key = seg.slice(0, idx).trim()
    const value = seg.slice(idx + 1).trim()
    out[key] = value
  }
  return out
}

function buildCookie(name, value, maxAge) {
  const safeName = encodeURIComponent(String(name || '').trim())
  const safeValue = encodeURIComponent(String(value || ''))
  const ttl = Number(maxAge) || 0
  const base = `${safeName}=${safeValue}; Path=/; HttpOnly; SameSite=Lax${getCookieSecureSuffix()}`
  if (ttl <= 0) {
    return `${base}; Max-Age=0`
  }
  return `${base}; Max-Age=${Math.floor(ttl)}`
}

function parseBearerToken(request) {
  const auth = String(request.headers.get('authorization') || '').trim()
  if (!auth) return ''
  if (!/^bearer\s+/i.test(auth)) return ''
  return auth.replace(/^bearer\s+/i, '').trim()
}

export function getUserCookieMap(request) {
  return parseCookiesFromHeader(request.headers.get('cookie'))
}

export function getAccessTokenFromRequest(request) {
  const bearer = parseBearerToken(request)
  if (bearer) return bearer
  const cookieMap = getUserCookieMap(request)
  return String(cookieMap[USER_ACCESS_COOKIE] || '')
}

export function buildUserSessionCookies(session) {
  const accessToken = String(session?.access_token || '')
  const refreshToken = String(session?.refresh_token || '')
  const ttl = getUserCookieTtlSec()
  return [
    buildCookie(USER_ACCESS_COOKIE, accessToken, ttl),
    buildCookie(USER_REFRESH_COOKIE, refreshToken, ttl)
  ]
}

export function buildClearUserSessionCookies() {
  return [
    buildCookie(USER_ACCESS_COOKIE, '', 0),
    buildCookie(USER_REFRESH_COOKIE, '', 0)
  ]
}

export async function loginWithPassword(email, password) {
  const configError = getSupabaseAnonConfigError()
  if (configError) throw new Error(configError)
  const anonClient = createSupabaseAnonClient()
  const { data, error } = await anonClient.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || '')
  })
  if (error) throw new Error(String(error.message || '登录失败'))
  if (!data?.session || !data?.user) {
    throw new Error('登录失败：未获取会话')
  }
  return {
    user: data.user,
    session: data.session
  }
}

export async function registerWithPassword(email, password) {
  const configError = getSupabaseAnonConfigError()
  if (configError) throw new Error(configError)
  const anonClient = createSupabaseAnonClient()
  const { data, error } = await anonClient.auth.signUp({
    email: String(email || '').trim(),
    password: String(password || '')
  })
  if (error) throw new Error(String(error.message || '注册失败'))
  return {
    user: data?.user || null,
    session: data?.session || null
  }
}

export async function resendSignupConfirmation(email, emailRedirectTo) {
  const configError = getSupabaseAnonConfigError()
  if (configError) throw new Error(configError)
  const anonClient = createSupabaseAnonClient()
  const { error } = await anonClient.auth.resend({
    type: 'signup',
    email: String(email || '').trim(),
    options: emailRedirectTo ? { emailRedirectTo: String(emailRedirectTo) } : undefined
  })
  if (error) throw new Error(String(error.message || '重发确认邮件失败'))
  return { success: true }
}

export async function sendPasswordResetEmail(email, redirectTo) {
  const configError = getSupabaseAnonConfigError()
  if (configError) throw new Error(configError)
  const anonClient = createSupabaseAnonClient()
  const { error } = await anonClient.auth.resetPasswordForEmail(
    String(email || '').trim(),
    redirectTo ? { redirectTo: String(redirectTo) } : undefined
  )
  if (error) throw new Error(String(error.message || '发送重置邮件失败'))
  return { success: true }
}

export async function requireUserAuth(request) {
  const configError = getSupabaseAnonConfigError()
  if (configError) {
    return {
      ok: false,
      status: 500,
      error: configError
    }
  }
  const accessToken = getAccessTokenFromRequest(request)
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      error: '未登录'
    }
  }
  const authResult = await getAuthUserWithRetry(accessToken)
  if (!authResult.ok && authResult.type === 'network') {
    return {
      ok: false,
      status: 503,
      error: '认证服务连接失败，请稍后重试'
    }
  }
  if (!authResult.ok || !authResult.user) {
    return {
      ok: false,
      status: 401,
      error: normalizeAuthErrorMessage(authResult.error || '登录已失效，请重新登录')
    }
  }
  return {
    ok: true,
    accessToken,
    user: authResult.user
  }
}

export async function updatePasswordWithAccessToken(accessToken, password) {
  const configError = getSupabaseAnonConfigError()
  if (configError) throw new Error(configError)
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  const token = String(accessToken || '').trim()
  const nextPassword = String(password || '')
  if (!token) {
    throw new Error('缺少访问凭证')
  }
  if (!nextPassword) {
    throw new Error('新密码不能为空')
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      password: nextPassword
    })
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      String(payload?.msg || payload?.error_description || payload?.error || '更新密码失败')
    )
  }
  return {
    user: payload?.user || null
  }
}

export async function updateProfileWithAccessToken(accessToken, profile) {
  const configError = getSupabaseAnonConfigError()
  if (configError) throw new Error(configError)
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  const token = String(accessToken || '').trim()
  const displayName = String(profile?.displayName || '').trim()
  if (!token) {
    throw new Error('缺少访问凭证')
  }
  if (!displayName) {
    throw new Error('用户名不能为空')
  }
  if (displayName.length > 32) {
    throw new Error('用户名最多 32 个字符')
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: {
        display_name: displayName
      }
    })
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      String(payload?.msg || payload?.error_description || payload?.error || '更新用户名失败')
    )
  }
  return {
    user: payload?.user || null
  }
}

export function generateSessionToken() {
  return crypto.randomBytes(24).toString('base64url')
}
