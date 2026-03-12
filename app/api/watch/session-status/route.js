import { getSupabaseConfigError } from '../../_lib/supabase-client'
import { getDeviceSessionStatus, touchDeviceMetadata } from '../../_lib/recorder-multiuser-store'
import { buildRateLimitResponse, consumeRateLimit, getClientIp } from '../../_lib/rate-limit'
import { getSecurityConfig } from '../../_lib/security-config'
import { createHash } from 'node:crypto'

function normalizeSessionToken(request, body) {
  const fromHeader = String(request.headers.get('x-device-session-token') || '').trim()
  if (fromHeader) return fromHeader
  return String(body?.sessionToken || '').trim()
}

function buildTokenFingerprint(token) {
  const text = String(token || '').trim()
  if (!text) return 'missing'
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

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
    const sessionToken = normalizeSessionToken(request, body)
    const deviceIdentity = normalizeDeviceIdentity(body)
    const identitySource = String(body?.identitySource || '').trim()
    const deviceSource = String(body?.deviceSource || '').trim()
    if (!sessionToken) {
      return Response.json(
        { success: false, error: 'sessionToken 不能为空' },
        { status: 400 }
      )
    }
    const security = getSecurityConfig()
    const ip = getClientIp(request)
    const tokenFp = buildTokenFingerprint(sessionToken)
    const limiter = consumeRateLimit(
      `session_status:${ip}:${tokenFp}`,
      security.rateLimit.pairStatus.max,
      security.rateLimit.pairStatus.windowSec
    )
    if (!limiter.ok) {
      return buildRateLimitResponse('查询设备会话状态过于频繁，请稍后重试', limiter.retryAfterSec)
    }

    const result = await getDeviceSessionStatus(sessionToken)
    const resolvedDeviceIdentity = String(result?.device?.device_identity || '').trim()
    const canPatchMetadata = !!(identitySource || deviceSource)
    if (canPatchMetadata) {
      const patchIdentity = resolvedDeviceIdentity || deviceIdentity
      const identityMatches = !deviceIdentity || !resolvedDeviceIdentity || deviceIdentity === resolvedDeviceIdentity
      if (patchIdentity && identityMatches) {
        try {
          await touchDeviceMetadata(patchIdentity, identitySource, deviceSource)
        } catch {
          // 元信息补写失败不影响会话状态主流程
        }
      }
    }
    return Response.json({
      success: true,
      active: result.active === true,
      status: String(result.status || ''),
      deviceId: String(result.device?.device_identity || ''),
      sessionExpiresAt: String(result.sessionExpiresAt || '')
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
