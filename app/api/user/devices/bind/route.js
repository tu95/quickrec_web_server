import { bindUserByPairCode } from '../../../_lib/recorder-multiuser-store'
import { requireUserAuth } from '../../../_lib/user-auth'
import { getSupabaseConfigError } from '../../../_lib/supabase-client'
import { buildRateLimitResponse, consumeRateLimit, getClientIp } from '../../../_lib/rate-limit'
import { getSecurityConfig } from '../../../_lib/security-config'

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
    const pairCode = String(body?.pairCode || '').trim()
    if (!pairCode) {
      return Response.json(
        { success: false, error: 'pairCode 不能为空' },
        { status: 400 }
      )
    }
    const security = getSecurityConfig()
    const ip = getClientIp(request)
    const limiter = consumeRateLimit(
      `bind:${ip}:${String(auth?.user?.id || '')}`,
      security.rateLimit.bind.max,
      security.rateLimit.bind.windowSec
    )
    if (!limiter.ok) {
      return buildRateLimitResponse('绑定尝试过于频繁，请稍后重试', limiter.retryAfterSec)
    }
    const result = await bindUserByPairCode(auth.user.id, pairCode)
    return Response.json({
      success: true,
      device: {
        id: String(result.device?.id || ''),
        deviceId: String(result.device?.device_identity || ''),
        identitySource: String(result.device?.identity_source || ''),
        deviceSource: String(result.device?.device_source || '')
      },
      sessionToken: String(result.sessionToken || ''),
      sessionExpiresAt: String(result.sessionExpiresAt || '')
    })
  } catch (error) {
    const text = String(error?.message || error)
    const status = (
      text.includes('过期') ||
      text.includes('不存在') ||
      text.includes('不可用') ||
      text.includes('已被使用')
    ) ? 400 : 500
    return Response.json(
      { success: false, error: text },
      { status }
    )
  }
}
