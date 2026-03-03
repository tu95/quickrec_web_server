import { requireUserAuth } from '../../_lib/user-auth'

export async function GET(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, authenticated: false, error: auth.error },
      { status: auth.status }
    )
  }
  return Response.json({
    success: true,
    authenticated: true,
    user: {
      id: String(auth?.user?.id || ''),
      email: String(auth?.user?.email || '')
    }
  })
}
