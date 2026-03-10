import { getSecurityConfig } from './security-config'

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

function normalizeIp(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1).slice(0, 120)
  return text.slice(0, 120)
}

function parseForwardedFor(headers) {
  const raw = String(headers.get('x-forwarded-for') || '')
  if (!raw) return []
  return raw
    .split(',')
    .map(item => normalizeIp(item))
    .filter(Boolean)
}

function parseIpv4ToInt(ip) {
  const text = normalizeIp(ip)
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null
  const seg = text.split('.').map(part => Number(part))
  if (seg.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return ((seg[0] << 24) >>> 0) + ((seg[1] << 16) >>> 0) + ((seg[2] << 8) >>> 0) + (seg[3] >>> 0)
}

function isIpv4InCidr(ip, cidr) {
  const cidrText = String(cidr || '').trim()
  if (!cidrText) return false
  const [baseIp, maskBitsRaw] = cidrText.split('/')
  const ipInt = parseIpv4ToInt(ip)
  const baseInt = parseIpv4ToInt(baseIp)
  if (ipInt == null || baseInt == null) return false
  const maskBits = maskBitsRaw == null ? 32 : Number(maskBitsRaw)
  if (!Number.isFinite(maskBits) || maskBits < 0 || maskBits > 32) return false
  if (maskBits === 0) return true
  const mask = ((0xffffffff << (32 - maskBits)) >>> 0)
  return (ipInt & mask) === (baseInt & mask)
}

function isInTrustedProxyCidrs(ip, cidrs) {
  const currentIp = normalizeIp(ip)
  if (!currentIp) return false
  const list = Array.isArray(cidrs) ? cidrs : []
  if (!list.length) return true
  return list.some(cidr => isIpv4InCidr(currentIp, cidr))
}

export function getClientIp(request) {
  if (!request || !request.headers) return ''
  const security = getSecurityConfig()
  const headers = request.headers
  const nativeIp = normalizeIp(request.ip || '')
  if (!security.proxy.trustForwardedHeaders) {
    return nativeIp || '0.0.0.0'
  }

  const forwardedChain = parseForwardedFor(headers)
  if (forwardedChain.length > 0) {
    const candidateClientIp = forwardedChain[0]
    const proxyHop = forwardedChain.length > 1 ? forwardedChain[forwardedChain.length - 1] : nativeIp
    if (isInTrustedProxyCidrs(proxyHop, security.proxy.trustedProxyCidrs)) {
      return candidateClientIp || '0.0.0.0'
    }
  }

  const cfIp = normalizeIp(headers.get('cf-connecting-ip'))
  if (cfIp) return cfIp
  const realIp = normalizeIp(headers.get('x-real-ip'))
  if (realIp) return realIp
  return nativeIp || '0.0.0.0'
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

export function resetRateLimit(key) {
  const name = String(key || '').trim()
  if (!name) return
  BUCKET_MAP.delete(name)
}

export function buildRateLimitResponse(errorText, retryAfterSec) {
  const headers = new Headers()
  headers.set('Retry-After', String(Math.max(Number(retryAfterSec) || 1, 1)))
  return Response.json(
    { success: false, error: String(errorText || '请求过于频繁，请稍后再试') },
    { status: 429, headers }
  )
}
