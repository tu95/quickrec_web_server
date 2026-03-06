import { normalizeAuthApiError } from '../../_lib/auth-error-map'
import { requireUserAuth, updateProfileWithAccessToken } from '../../_lib/user-auth'

function toUserView(user) {
  const meta = user?.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {}
  const displayName = String(meta.display_name || meta.full_name || meta.name || '').trim()
  return {
    id: String(user?.id || ''),
    email: String(user?.email || ''),
    displayName
  }
}

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
    const displayName = String(body?.displayName || body?.username || '').trim()
    if (!displayName) {
      return Response.json(
        { success: false, error: '用户名不能为空' },
        { status: 400 }
      )
    }
    const updated = await updateProfileWithAccessToken(auth.accessToken, { displayName })
    return Response.json({
      success: true,
      user: toUserView(updated?.user || auth.user)
    })
  } catch (error) {
    const normalized = normalizeAuthApiError(error?.message || error, 'updateProfile')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
