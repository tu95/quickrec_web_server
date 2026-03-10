import { requireUserAuth } from '../../../../_lib/user-auth'
import {
  activateUserConfigProfile,
  sanitizeConfigForClient
} from '../../../../_lib/config-store'

export async function POST(request, { params }) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status || 401 })
  }
  try {
    const routeParams = await params
    const profile = await activateUserConfigProfile(auth.user?.id, String(routeParams?.id || '').trim())
    return Response.json({
      success: true,
      profile: {
        ...profile,
        config: sanitizeConfigForClient(profile.config)
      }
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
