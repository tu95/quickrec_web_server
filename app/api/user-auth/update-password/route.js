import { requireUserAuth, updatePasswordWithAccessToken } from '../../_lib/user-auth'
import { normalizeAuthApiError } from '../../_lib/auth-error-map'

export async function POST(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }

  try {
    const body = await request.json().catch(() => null)
    const password = String(body?.password || '')
    if (!password) {
      return Response.json(
        { success: false, error: '新密码不能为空' },
        { status: 400 }
      )
    }
    if (password.length < 6) {
      return Response.json(
        { success: false, error: '密码至少 6 位' },
        { status: 400 }
      )
    }
    await updatePasswordWithAccessToken(auth.accessToken, password)
    return Response.json({ success: true })
  } catch (error) {
    const normalized = normalizeAuthApiError(error?.message || error, 'updatePassword')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
