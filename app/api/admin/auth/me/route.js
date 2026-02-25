import { requireAdminAuth } from '../../../_lib/admin-auth'

export async function GET(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  return Response.json({ success: true })
}

