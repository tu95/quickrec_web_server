import { requireUserAuth } from '../../_lib/user-auth'

function toUserView(user) {
  const meta = user?.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {}
  const displayName = String(meta.display_name || meta.full_name || meta.name || '').trim()
  return {
    id: String(user?.id || ''),
    email: String(user?.email || ''),
    createdAt: String(user?.created_at || ''),
    displayName
  }
}

export async function GET(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, authenticated: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }
  return Response.json({
    success: true,
    authenticated: true,
    user: toUserView(auth.user)
  })
}
