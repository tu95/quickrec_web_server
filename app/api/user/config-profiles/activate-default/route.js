import { requireUserAuth } from '../../../_lib/user-auth'
import { clearActiveUserConfigProfile } from '../../../_lib/config-store'

export async function POST(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status || 401 })
  }
  try {
    await clearActiveUserConfigProfile(auth.user?.id)
    return Response.json({ success: true })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
