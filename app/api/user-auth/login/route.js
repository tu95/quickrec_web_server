import { buildUserSessionCookies, loginWithPassword } from '../../_lib/user-auth'
import { buildAuthSecurityBlockResponse } from '../../_lib/auth-security'
import { normalizeAuthApiError } from '../../_lib/auth-error-map'

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
    const normalized = normalizeAuthApiError(error?.message || error, 'login')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
