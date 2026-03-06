import crypto from 'crypto'
import {
  createSupabaseAnonClient,
  getSupabaseAnonConfigError,
  getSupabaseAnonKey,
  getSupabaseUrl
} from './supabase-client'

export const USER_ACCESS_COOKIE = 'zr_user_access_token'
export const USER_REFRESH_COOKIE = 'zr_user_refresh_token'

const USER_COOKIE_TTL_SEC = 60 * 60 * 24 * 14

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
  const base = `${safeName}=${safeValue}; Path=/; HttpOnly; SameSite=Lax`
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
  return [
    buildCookie(USER_ACCESS_COOKIE, accessToken, USER_COOKIE_TTL_SEC),
    buildCookie(USER_REFRESH_COOKIE, refreshToken, USER_COOKIE_TTL_SEC)
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
  const anonClient = createSupabaseAnonClient()
  let data = null
  let error = null
  try {
    const result = await anonClient.auth.getUser(accessToken)
    data = result?.data || null
    error = result?.error || null
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: `认证服务连接失败，请稍后重试（${String(err?.message || err)}）`
    }
  }
  if (error || !data?.user) {
    return {
      ok: false,
      status: 401,
      error: String(error?.message || '登录已失效')
    }
  }
  return {
    ok: true,
    accessToken,
    user: data.user
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
