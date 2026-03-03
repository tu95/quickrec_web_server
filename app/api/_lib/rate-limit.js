const BUCKET_MAP = new Map()

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function cleanupExpired(now) {
  if (BUCKET_MAP.size <= 2000) return
  for (const [key, value] of BUCKET_MAP.entries()) {
    if (!value || Number(value.resetAtSec || 0) <= now) {
      BUCKET_MAP.delete(key)
    }
  }
}

export function getClientIp(request) {
  if (!request || !request.headers) return ''
  const headers = request.headers
  const forwarded = String(headers.get('x-forwarded-for') || '')
  if (forwarded) {
    const first = forwarded.split(',')[0]
    const ip = String(first || '').trim()
    if (ip) return ip.slice(0, 120)
  }
  const cfIp = String(headers.get('cf-connecting-ip') || '').trim()
  if (cfIp) return cfIp.slice(0, 120)
  const realIp = String(headers.get('x-real-ip') || '').trim()
  if (realIp) return realIp.slice(0, 120)
  return '0.0.0.0'
}

export function consumeRateLimit(key, max, windowSec) {
  const name = String(key || '').trim()
  const limit = Number(max) || 0
  const window = Number(windowSec) || 0
  if (!name || limit <= 0 || window <= 0) {
    return { ok: true, remaining: limit, retryAfterSec: 0 }
  }
  const now = nowSec()
  cleanupExpired(now)

  const bucket = BUCKET_MAP.get(name)
  if (!bucket || Number(bucket.resetAtSec || 0) <= now) {
    BUCKET_MAP.set(name, {
      count: 1,
      resetAtSec: now + window
    })
    return { ok: true, remaining: Math.max(limit - 1, 0), retryAfterSec: 0 }
  }

  if (bucket.count >= limit) {
    const retryAfterSec = Math.max(Number(bucket.resetAtSec || 0) - now, 1)
    return { ok: false, remaining: 0, retryAfterSec }
  }

  bucket.count += 1
  BUCKET_MAP.set(name, bucket)
  return {
    ok: true,
    remaining: Math.max(limit - bucket.count, 0),
    retryAfterSec: 0
  }
}

export function buildRateLimitResponse(errorText, retryAfterSec) {
  const headers = new Headers()
  headers.set('Retry-After', String(Math.max(Number(retryAfterSec) || 1, 1)))
  return Response.json(
    { success: false, error: String(errorText || '请求过于频繁，请稍后再试') },
    { status: 429, headers }
  )
}
