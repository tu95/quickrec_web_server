import { NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const ACCESS_COOKIE = 'zr_user_access_token'
const REFRESH_COOKIE = 'zr_user_refresh_token'

const handleI18nRouting = createIntlMiddleware(routing)

function readEnv(name) {
  return String(process.env[name] || '').trim()
}

function getSupabaseUrl() {
  return readEnv('SUPABASE_URL') || readEnv('NEXT_PUBLIC_SUPABASE_URL')
}

function getSupabaseAnonKey() {
  return (
    readEnv('SUPABASE_ANON_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_PUBLISHABLE_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  )
}

function parseBool(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return null
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false
  return null
}

function readInt(raw, fallback, min, max) {
  const parsed = Number(raw)
  let value = Number.isFinite(parsed) ? Math.floor(parsed) : Number(fallback)
  if (Number.isFinite(min)) value = Math.max(value, Number(min))
  if (Number.isFinite(max)) value = Math.min(value, Number(max))
  return value
}

function getSessionTtlSec() {
  return readInt(readEnv('USER_SESSION_TTL_SEC'), 60 * 60 * 24, 600, 60 * 60 * 24 * 30)
}

function shouldUseSecureCookies(request) {
  const forced = parseBool(readEnv('COOKIE_SECURE'))
  if (forced !== null) return forced
  if (String(readEnv('APP_PUBLIC_ORIGIN')).toLowerCase().startsWith('https://')) return true
  return String(request?.nextUrl?.protocol || '').toLowerCase() === 'https:'
}

function setUserSessionCookies(response, accessToken, refreshToken, request) {
  const secure = shouldUseSecureCookies(request)
  const maxAge = getSessionTtlSec()
  const opts = { path: '/', maxAge, httpOnly: true, sameSite: 'lax', secure }
  if (String(accessToken || '').trim()) {
    response.cookies.set(ACCESS_COOKIE, String(accessToken).trim(), opts)
  }
  if (String(refreshToken || '').trim()) {
    response.cookies.set(REFRESH_COOKIE, String(refreshToken).trim(), opts)
  }
}

function clearUserSessionCookies(response, request) {
  const secure = shouldUseSecureCookies(request)
  const opts = { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure }
  response.cookies.set(ACCESS_COOKIE, '', opts)
  response.cookies.set(REFRESH_COOKIE, '', opts)
  return response
}

async function validateAccessTokenWithSupabase(token) {
  const accessToken = String(token || '').trim()
  if (!accessToken) return { ok: false, reason: 'missing' }
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  if (!url || !anonKey) return { ok: false, reason: 'misconfigured' }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    try {
      controller.abort()
    } catch {}
  }, 5000)

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      cache: 'no-store',
      signal: controller.signal
    })
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) return { ok: false, reason: 'unreachable' }
      return { ok: false, reason: 'invalid' }
    }
    const data = await res.json().catch(() => null)
    const userId = String(data?.id || data?.user?.id || '').trim()
    if (!userId) return { ok: false, reason: 'invalid' }
    return { ok: true, userId }
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}

async function refreshSessionWithSupabase(refreshToken) {
  const token = String(refreshToken || '').trim()
  if (!token) return { ok: false, reason: 'missing' }
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  if (!url || !anonKey) return { ok: false, reason: 'misconfigured' }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    try {
      controller.abort()
    } catch {}
  }, 7000)

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: token }),
      cache: 'no-store',
      signal: controller.signal
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) return { ok: false, reason: 'unreachable' }
      return { ok: false, reason: 'invalid', error: String(data?.msg || data?.error || '') }
    }
    const nextAccessToken = String(data?.access_token || '').trim()
    const nextRefreshToken = String(data?.refresh_token || '').trim()
    if (!nextAccessToken || !nextRefreshToken) {
      return { ok: false, reason: 'invalid' }
    }
    return {
      ok: true,
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken
    }
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 从 URL 中去除 locale 前缀，返回实际页面路径
 */
function stripLocalePrefix(pathname) {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }
  return pathname
}

function buildLoginRedirect(request, pathname) {
  const pagePath = stripLocalePrefix(pathname)
  const localeMatch = routing.locales.find(
    l => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  )
  const locale = localeMatch || routing.defaultLocale

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = locale === routing.defaultLocale ? '/login' : `/${locale}/login`
  const nextPath = `${pathname}${request.nextUrl.search || ''}`
  loginUrl.searchParams.set('next', nextPath)
  return loginUrl
}

export async function middleware(request) {
  const method = String(request.method || '').toUpperCase()
  const hasNextActionHeader = !!request.headers.get('next-action')
  const pathname = request.nextUrl.pathname || '/'
  const isApiRoute = pathname.startsWith('/api/')
  const hasFileExt = /\.(?:png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot|mp3|mp4|opus|wav|pdf|json|xml|txt|map)$/i.test(pathname)
  const isStaticAsset = pathname.startsWith('/_next/') || pathname === '/favicon.ico' || hasFileExt

  if (method === 'POST' && hasNextActionHeader && !isApiRoute && !isStaticAsset) {
    const url = request.nextUrl.clone()
    return NextResponse.redirect(url, 303)
  }

  if (isStaticAsset) {
    return NextResponse.next()
  }

  // API 路由：不走 i18n，只做 auth
  if (isApiRoute) {
    const userSession = String(request.cookies.get(ACCESS_COOKIE)?.value || '').trim()
    const refreshToken = String(request.cookies.get(REFRESH_COOKIE)?.value || '').trim()
    const authHeader = String(request.headers.get('authorization') || '').trim()
    const deviceSessionToken = String(request.headers.get('x-device-session-token') || '').trim()
    const hasBearerAuth = /^bearer\s+/i.test(authHeader)
    const bearerToken = hasBearerAuth ? authHeader.replace(/^bearer\s+/i, '').trim() : ''
    const hasDeviceSessionToken = !!deviceSessionToken
    const hasUserSession = !!userSession
    const hasRefreshToken = !!refreshToken
    const protectedApiPrefixes = [
      '/api/admin/',
      '/api/user/',
      '/api/user-auth/me',
      '/api/user-auth/profile',
      '/api/user-auth/change-password',
      '/api/files',
      '/api/meeting-notes',
      '/api/convert-mp3',
      '/api/upload',
      '/api/upload-test',
      '/api/upload-chunk'
    ]
    const isProtectedApi = protectedApiPrefixes.some(prefix => pathname.startsWith(prefix))

    if (!isProtectedApi) return NextResponse.next()
    if (pathname === '/api/upload' && hasDeviceSessionToken) return NextResponse.next()

    if (hasBearerAuth) {
      const verified = await validateAccessTokenWithSupabase(bearerToken)
      if (verified.ok) return NextResponse.next()
      if (verified.reason === 'unreachable') {
        return NextResponse.json(
          { success: false, error: '认证服务暂时不可用，请稍后重试' },
          { status: 503 }
        )
      }
      return NextResponse.json(
        { success: false, error: '未登录，请先访问 /login' },
        { status: 401 }
      )
    }

    if (!hasUserSession && !hasRefreshToken) {
      const response = NextResponse.json(
        { success: false, error: '未登录，请先访问 /login' },
        { status: 401 }
      )
      return clearUserSessionCookies(response, request)
    }

    if (hasUserSession) {
      const verified = await validateAccessTokenWithSupabase(userSession)
      if (verified.ok) return NextResponse.next()
      if (verified.reason === 'unreachable') {
        return NextResponse.json(
          { success: false, error: '认证服务暂时不可用，请稍后重试' },
          { status: 503 }
        )
      }
    }

    if (hasRefreshToken) {
      const refreshed = await refreshSessionWithSupabase(refreshToken)
      if (refreshed.ok) {
        const headers = new Headers(request.headers)
        headers.set('authorization', `Bearer ${refreshed.accessToken}`)
        const response = NextResponse.next({ request: { headers } })
        setUserSessionCookies(response, refreshed.accessToken, refreshed.refreshToken, request)
        return response
      }
      if (refreshed.reason === 'unreachable') {
        return NextResponse.json(
          { success: false, error: '认证服务暂时不可用，请稍后重试' },
          { status: 503 }
        )
      }
    }

    const response = NextResponse.json(
      { success: false, error: '未登录，请先访问 /login' },
      { status: 401 }
    )
    return clearUserSessionCookies(response, request)
  }

  // 页面路由：先走 i18n 再做 auth
  const pagePath = stripLocalePrefix(pathname)
  const isLoginPage = pagePath === '/login' || pagePath === '/user/login'
  const userSession = String(request.cookies.get(ACCESS_COOKIE)?.value || '').trim()
  const refreshToken = String(request.cookies.get(REFRESH_COOKIE)?.value || '').trim()
  const hasUserSession = !!userSession
  const hasRefreshToken = !!refreshToken

  // 未登录且不在登录页 → 跳转登录
  if (!isLoginPage && !hasUserSession && !hasRefreshToken) {
    const response = NextResponse.redirect(buildLoginRedirect(request, pathname))
    return clearUserSessionCookies(response, request)
  }

  // 有 refresh token 无 session → 尝试刷新
  if (!isLoginPage && !hasUserSession && hasRefreshToken) {
    const refreshed = await refreshSessionWithSupabase(refreshToken)
    if (refreshed.ok) {
      const intlResponse = handleI18nRouting(request)
      setUserSessionCookies(intlResponse, refreshed.accessToken, refreshed.refreshToken, request)
      return intlResponse
    }
    if (refreshed.reason === 'invalid') {
      const response = NextResponse.redirect(buildLoginRedirect(request, pathname))
      return clearUserSessionCookies(response, request)
    }
  }

  return handleI18nRouting(request)
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
}
