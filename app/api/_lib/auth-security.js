import { buildRateLimitResponse, consumeRateLimit, getClientIp } from './rate-limit'
import { getSecurityConfig } from './security-config'
import { verifyTurnstileToken } from './turnstile'

export async function buildAuthSecurityBlockResponse(input) {
  const params = input && typeof input === 'object' ? input : {}
  const request = params.request
  const body = (params.body && typeof params.body === 'object') ? params.body : {}
  const scene = String(params.scene || 'auth').trim()
  const email = String(params.email || '').trim().toLowerCase()
  const security = getSecurityConfig()
  const ip = getClientIp(request)

  const limiter = consumeRateLimit(
    `auth:${scene}:${ip}:${email || '-'}`,
    security.rateLimit.auth.max,
    security.rateLimit.auth.windowSec
  )
  if (!limiter.ok) {
    return buildRateLimitResponse('操作过于频繁，请稍后重试', limiter.retryAfterSec)
  }

  const token = String(body.turnstileToken || body.cfTurnstileToken || '').trim()
  const verify = await verifyTurnstileToken(request, token, scene)
  if (!verify.ok) {
    return Response.json(
      { success: false, error: verify.error },
      { status: verify.status || 403 }
    )
  }

  return null
}
