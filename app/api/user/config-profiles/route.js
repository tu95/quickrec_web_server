import { requireUserAuth } from '../../_lib/user-auth'
import {
  createUserConfigProfile,
  listUserConfigProfiles,
  sanitizeConfigForClient
} from '../../_lib/config-store'

function toClientProfile(profile) {
  return {
    ...profile,
    config: sanitizeConfigForClient(profile.config)
  }
}

export async function GET(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status || 401 })
  }
  try {
    const result = await listUserConfigProfiles(auth.user?.id)
    return Response.json({
      success: true,
      profiles: result.profiles.map(toClientProfile),
      activeProfileId: result.profiles.find(item => item.isActive)?.id || '',
      systemDefaultProfile: result.systemDefaultProfile
        ? {
            ...result.systemDefaultProfile,
            config: sanitizeConfigForClient(result.systemDefaultProfile.config)
          }
        : null
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status || 401 })
  }
  const body = await request.json().catch(() => null)
  const name = String(body?.name || '').trim()
  try {
    const profile = await createUserConfigProfile(auth.user?.id, name)
    return Response.json({ success: true, profile: toClientProfile(profile) })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
