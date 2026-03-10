import { requireAdminAuth } from '../../../_lib/admin-auth'
import {
  deleteSystemConfigProfile,
  listSystemConfigProfiles,
  mergeConfigWithSecretPreserve,
  sanitizeConfigForClient,
  updateSystemConfigProfile
} from '../../../_lib/config-store'

function toClientProfile(profile) {
  return {
    ...profile,
    config: sanitizeConfigForClient(profile.config)
  }
}

export async function PUT(request, { params }) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const profileId = String(params?.id || '').trim()
  const body = await request.json().catch(() => null)
  const payload = body && typeof body === 'object' ? (body.config || body) : null
  const name = String(body?.name || payload?.name || '').trim()
  if (!payload || typeof payload !== 'object') {
    return Response.json({ success: false, error: 'invalid config payload' }, { status: 400 })
  }

  const profiles = await listSystemConfigProfiles(auth.user?.id)
  const target = profiles.find(item => item.id === profileId)
  if (!target) {
    return Response.json({ success: false, error: '系统配置不存在' }, { status: 404 })
  }
  const mergedPayload = mergeConfigWithSecretPreserve(target.config, payload)
  try {
    const profile = await updateSystemConfigProfile(profileId, mergedPayload, auth.user?.id, name)
    return Response.json({ success: true, profile: toClientProfile(profile) })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }
  try {
    await deleteSystemConfigProfile(String(params?.id || '').trim(), auth.user?.id)
    return Response.json({ success: true })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
