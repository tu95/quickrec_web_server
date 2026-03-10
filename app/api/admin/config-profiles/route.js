import { requireAdminAuth } from '../../_lib/admin-auth'
import {
  createSystemConfigProfile,
  listSystemConfigProfiles,
  sanitizeConfigForClient
} from '../../_lib/config-store'

function toClientProfile(profile) {
  return {
    ...profile,
    config: sanitizeConfigForClient(profile.config)
  }
}

export async function GET(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }
  try {
    const profiles = await listSystemConfigProfiles(auth.user?.id)
    return Response.json({
      success: true,
      profiles: profiles.map(toClientProfile),
      defaultProfileId: profiles.find(item => item.isDefault)?.id || ''
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const body = await request.json().catch(() => null)
  const name = String(body?.name || '').trim()
  try {
    const profile = await createSystemConfigProfile(auth.user?.id, name)
    return Response.json({ success: true, profile: toClientProfile(profile) })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
