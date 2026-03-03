import { createPairCodeForDevice } from '../../_lib/recorder-multiuser-store'
import { getSupabaseConfigError } from '../../_lib/supabase-client'
import { buildRateLimitResponse, consumeRateLimit, getClientIp } from '../../_lib/rate-limit'
import { getSecurityConfig } from '../../_lib/security-config'

function normalizeDeviceIdentity(body) {
  if (!body || typeof body !== 'object') return ''
  return String(body.deviceId || body.deviceIdentity || body.watchUuid || '').trim()
}

function normalizeBoolFlag(value) {
  if (value === true) return true
  const text = String(value || '').trim().toLowerCase()
  return text === '1' || text === 'true' || text === 'yes' || text === 'on'
}

export async function POST(request) {
  const configError = getSupabaseConfigError()
  if (configError) {
    return Response.json(
      { success: false, error: configError },
      { status: 500 }
    )
  }

  try {
    const body = await request.json().catch(() => null)
    const deviceIdentity = normalizeDeviceIdentity(body)
    const identitySource = String(body?.identitySource || '').trim()
    const deviceSource = String(body?.deviceSource || '').trim()
    const forceRebind = normalizeBoolFlag(body?.forceRebind)
    if (!deviceIdentity) {
      return Response.json(
        { success: false, error: 'deviceId 不能为空' },
        { status: 400 }
      )
    }
    const security = getSecurityConfig()
    const ip = getClientIp(request)
    const limiter = consumeRateLimit(
      `pair_code:${ip}:${deviceIdentity}`,
      security.rateLimit.pairCode.max,
      security.rateLimit.pairCode.windowSec
    )
    if (!limiter.ok) {
      return buildRateLimitResponse('获取配对码过于频繁，请稍后重试', limiter.retryAfterSec)
    }
    const result = await createPairCodeForDevice(
      deviceIdentity,
      identitySource,
      deviceSource,
      { forceRebind }
    )
    return Response.json({
      success: true,
      deviceId: String(result.device?.device_identity || deviceIdentity),
      pairCode: String(result.pairCode || ''),
      expiresAt: String(result.expiresAt || ''),
      alreadyPaired: result.alreadyPaired === true,
      status: String(result.status || ''),
      sessionToken: String(result.sessionToken || ''),
      sessionExpiresAt: String(result.sessionExpiresAt || ''),
      bindPath: '/pair'
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
