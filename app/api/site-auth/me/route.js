import { requireSiteAuth } from '../../_lib/admin-auth'

export async function GET(request) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, authenticated: false, error: auth.error },
      { status: auth.status }
    )
  }
  return Response.json({
    success: true,
    authenticated: true,
    role: auth.role || 'admin',
    readOnly: auth.readOnly === true
  })
}
