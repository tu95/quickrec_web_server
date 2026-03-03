import { unbindUserDevice } from '../../../_lib/recorder-multiuser-store'
import { requireUserAuth } from '../../../_lib/user-auth'
import { getSupabaseConfigError } from '../../../_lib/supabase-client'
import { buildRateLimitResponse, consumeRateLimit, getClientIp } from '../../../_lib/rate-limit'
import { getSecurityConfig } from '../../../_lib/security-config'
import { resolveDeviceModel } from '../../../_lib/device-model-map'

export async function POST(request) {
  const configError = getSupabaseConfigError()
  if (configError) {
    return Response.json(
      { success: false, error: configError },
      { status: 500 }
    )
  }

  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }

  try {
    const body = await request.json().catch(() => null)
    const deviceId = String(body?.deviceId || '').trim()
    if (!deviceId) {
      return Response.json(
        { success: false, error: 'deviceId 不能为空' },
        { status: 400 }
      )
    }

    const security = getSecurityConfig()
    const ip = getClientIp(request)
    const limiter = consumeRateLimit(
      `unbind:${ip}:${String(auth?.user?.id || '')}:${deviceId}`,
      security.rateLimit.bind.max,
      security.rateLimit.bind.windowSec
    )
    if (!limiter.ok) {
      return buildRateLimitResponse('解绑操作过于频繁，请稍后重试', limiter.retryAfterSec)
    }

    const result = await unbindUserDevice(auth.user.id, deviceId)
    return Response.json({
      success: true,
      alreadyUnbound: !!result.alreadyUnbound,
      device: {
        id: String(result?.device?.id || ''),
        deviceId: String(result?.device?.device_identity || ''),
        identitySource: String(result?.device?.identity_source || ''),
        deviceSource: String(result?.device?.device_source || ''),
        deviceModel: resolveDeviceModel({
          deviceSource: result?.device?.device_source,
          deviceId: result?.device?.device_identity
        })
      }
    })
  } catch (error) {
    const text = String(error?.message || error)
    const status = text.includes('未绑定') ? 404 : 500
    return Response.json(
      { success: false, error: text },
      { status }
    )
  }
}
