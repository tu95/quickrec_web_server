import { getSupabaseConfigError } from '../../_lib/supabase-client'
import { issueDeviceSessionByPairCode } from '../../_lib/recorder-multiuser-store'
import { buildRateLimitResponse, consumeRateLimit, getClientIp, resetRateLimit } from '../../_lib/rate-limit'
import { getSecurityConfig } from '../../_lib/security-config'

function normalizeDeviceIdentity(body) {
  if (!body || typeof body !== 'object') return ''
  return String(body.deviceId || body.deviceIdentity || body.watchUuid || '').trim()
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
    const pairCode = String(body?.pairCode || '').trim()
    if (!deviceIdentity || !pairCode) {
      return Response.json(
        { success: false, error: 'deviceId 和 pairCode 不能为空' },
        { status: 400 }
      )
    }
    const security = getSecurityConfig()
    const ip = getClientIp(request)
    const failKey = `pair_fail:${ip}:${deviceIdentity}`
    const limiter = consumeRateLimit(
      `pair_status:${ip}:${deviceIdentity}`,
      security.rateLimit.pairStatus.max,
      security.rateLimit.pairStatus.windowSec
    )
    if (!limiter.ok) {
      return buildRateLimitResponse('查询配对状态过于频繁，请稍后重试', limiter.retryAfterSec)
    }

    const result = await issueDeviceSessionByPairCode(deviceIdentity, pairCode)
    if (result.paired) {
      resetRateLimit(failKey)
    } else {
      const failLimiter = consumeRateLimit(
        failKey,
        security.pair.maxFails,
        security.pair.lockSec
      )
      if (!failLimiter.ok) {
        return buildRateLimitResponse('配对失败过多，请稍后重试', failLimiter.retryAfterSec)
      }
    }
    return Response.json({
      success: true,
      paired: !!result.paired,
      status: String(result.status || ''),
      deviceId: String(result.device?.device_identity || deviceIdentity),
      sessionToken: String(result.sessionToken || ''),
      sessionExpiresAt: String(result.sessionExpiresAt || '')
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
