import { requireUserAuth } from '../../../_lib/user-auth'
import {
  deleteUserConfigProfile,
  listUserConfigProfiles,
  mergeConfigWithSecretPreserve,
  sanitizeConfigForClient,
  updateUserConfigProfile
} from '../../../_lib/config-store'

function toClientProfile(profile) {
  return {
    ...profile,
    config: sanitizeConfigForClient(profile.config)
  }
}

export async function PUT(request, { params }) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status || 401 })
  }
  const routeParams = await params
  const profileId = String(routeParams?.id || '').trim()
  const body = await request.json().catch(() => null)
  const payload = body && typeof body === 'object' ? (body.config || body) : null
  const name = String(body?.name || payload?.name || '').trim()
  if (!payload || typeof payload !== 'object') {
    return Response.json({ success: false, error: 'invalid config payload' }, { status: 400 })
  }

  const listing = await listUserConfigProfiles(auth.user?.id)
  const target = listing.profiles.find(item => item.id === profileId)
  if (!target) {
    return Response.json({ success: false, error: '个人配置不存在' }, { status: 404 })
  }
  const mergedPayload = mergeConfigWithSecretPreserve(target.config, payload)
  try {
    const profile = await updateUserConfigProfile(auth.user?.id, profileId, mergedPayload, name)
    return Response.json({ success: true, profile: toClientProfile(profile) })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status || 401 })
  }
  try {
    const routeParams = await params
    await deleteUserConfigProfile(auth.user?.id, String(routeParams?.id || '').trim())
    return Response.json({ success: true })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
