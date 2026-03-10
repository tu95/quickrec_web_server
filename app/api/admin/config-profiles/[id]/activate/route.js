import { requireAdminAuth } from '../../../../_lib/admin-auth'
import {
  activateSystemConfigProfile,
  sanitizeConfigForClient
} from '../../../../_lib/config-store'

export async function POST(request, { params }) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }
  try {
    const profile = await activateSystemConfigProfile(String(params?.id || '').trim(), auth.user?.id)
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
