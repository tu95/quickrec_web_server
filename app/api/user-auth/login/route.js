import { buildUserSessionCookies, loginWithPassword } from '../../_lib/user-auth'
import { buildAuthSecurityBlockResponse } from '../../_lib/auth-security'

function createHeadersWithCookies(cookies) {
  const headers = new Headers()
  const list = Array.isArray(cookies) ? cookies : []
  for (const cookie of list) {
    headers.append('Set-Cookie', cookie)
  }
  return headers
}

function toUserView(user) {
  return {
    id: String(user?.id || ''),
    email: String(user?.email || ''),
    createdAt: String(user?.created_at || '')
  }
}

function normalizeLoginError(rawError) {
  const text = String(rawError || '').trim()
  const lower = text.toLowerCase()
  if (lower.includes('email not confirmed')) {
    return {
      status: 403,
      error: '邮箱还未完成验证。请先去邮箱点击确认链接，再回来登录；如果没收到邮件，请点下方“重发确认邮件”。'
    }
  }
  if (lower.includes('invalid login credentials')) {
    return {
      status: 401,
      error: '邮箱或密码不正确，请检查后重试。'
    }
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return {
      status: 429,
      error: '操作太频繁，请稍后再试。'
    }
  }
  return {
    status: 401,
    error: text || '登录失败，请稍后重试。'
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '').trim()
    const password = String(body?.password || '')
    if (!email || !password) {
      return Response.json(
        { success: false, error: '邮箱和密码不能为空' },
        { status: 400 }
      )
    }
    const blocked = await buildAuthSecurityBlockResponse({
      request,
      body,
      scene: 'login',
      email
    })
    if (blocked) return blocked

    const login = await loginWithPassword(email, password)
    const headers = createHeadersWithCookies(buildUserSessionCookies(login.session))
    return Response.json(
      {
        success: true,
        user: toUserView(login.user)
      },
      { headers }
    )
  } catch (error) {
    const normalized = normalizeLoginError(error?.message || error)
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
