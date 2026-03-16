import { requireAdminAuth } from '../../../_lib/admin-auth'
import { getAdminSettingsToken } from '../../../../_lib/admin-settings-route'
import { triggerPendingUploadsRecovery } from '../../../watch/upload-chunk/route'

function hasValidAdminSettingsToken(request) {
  const expected = String(getAdminSettingsToken() || '').trim()
  if (!expected) return false
  const provided = String(request.headers.get('x-admin-settings-token') || '').trim()
  return !!provided && provided === expected
}

async function authorize(request) {
  if (hasValidAdminSettingsToken(request)) {
    return { ok: true, source: 'settings-token' }
  }
  const auth = await requireAdminAuth(request)
  if (!auth.ok) return auth
  return { ok: true, source: 'site-auth' }
}

export async function POST(request) {
  const auth = await authorize(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error || '仅管理员可访问' },
      { status: auth.status || 403 }
    )
  }
  try {
    const result = await triggerPendingUploadsRecovery()
    return Response.json({
      success: true,
      triggeredBy: auth.source || 'admin',
      ...result
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
