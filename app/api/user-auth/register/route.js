import { buildUserSessionCookies, registerWithPassword } from '../../_lib/user-auth'
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

function resolveErrorStatus(errorText) {
  const text = String(errorText || '').toLowerCase()
  if (text.includes('rate limit') || text.includes('too many')) return 429
  return 400
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
    if (password.length < 6) {
      return Response.json(
        { success: false, error: '密码至少 6 位' },
        { status: 400 }
      )
    }
    const blocked = await buildAuthSecurityBlockResponse({
      request,
      body,
      scene: 'register',
      email
    })
    if (blocked) return blocked
    const result = await registerWithPassword(email, password)
    const requiresEmailConfirm = !result.session
    const headers = requiresEmailConfirm
      ? undefined
      : createHeadersWithCookies(buildUserSessionCookies(result.session))
    return Response.json(
      {
        success: true,
        user: toUserView(result.user),
        requiresEmailConfirm
      },
      headers ? { headers } : undefined
    )
  } catch (error) {
    const message = String(error?.message || error)
    return Response.json(
      { success: false, error: message },
      { status: resolveErrorStatus(message) }
    )
  }
}
