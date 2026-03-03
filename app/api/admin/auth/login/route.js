import {
  buildUserSessionCookies,
  loginWithPassword
} from '../../../_lib/user-auth'

function createHeadersWithCookies(cookies) {
  const headers = new Headers()
  const list = Array.isArray(cookies) ? cookies : []
  for (const cookie of list) {
    headers.append('Set-Cookie', cookie)
  }
  return headers
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
    const login = await loginWithPassword(email, password)
    const headers = createHeadersWithCookies(buildUserSessionCookies(login.session))
    return Response.json(
      { success: true },
      { headers }
    )
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 401 }
    )
  }
}
