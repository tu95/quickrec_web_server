const CACHE_PREFIX = 'zr_api_cache_v1'
const USER_KEY = 'zr_cache_user_id'

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function normalizePart(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9_./:-]/g, '_')
}

export function getCachedUserId() {
  if (!hasWindow()) return ''
  try {
    return String(window.localStorage.getItem(USER_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setCachedUserId(userId) {
  const value = String(userId || '').trim()
  if (!value || !hasWindow()) return
  try {
    window.localStorage.setItem(USER_KEY, value)
  } catch {}
}

export function buildApiCacheKey(userId, apiPath) {
  const safeUserId = normalizePart(userId) || 'anonymous'
  const safePath = normalizePart(apiPath) || 'unknown'
  return `${CACHE_PREFIX}:${safeUserId}:${safePath}`
}

export function readApiCache(userId, apiPath, ttlMs) {
  if (!hasWindow()) return { hit: false, stale: false, data: null, updatedAt: 0 }
  const key = buildApiCacheKey(userId, apiPath)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return { hit: false, stale: false, data: null, updatedAt: 0 }
    const parsed = JSON.parse(raw)
    const updatedAt = Number(parsed?.updatedAt || 0)
    const data = parsed?.data
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return { hit: false, stale: false, data: null, updatedAt: 0 }
    }
    const maxAge = Number(ttlMs)
    const stale = Number.isFinite(maxAge) && maxAge > 0
      ? (Date.now() - updatedAt) > maxAge
      : false
    if (stale) {
      return { hit: false, stale: true, data: null, updatedAt }
    }
    return { hit: true, stale: false, data, updatedAt }
  } catch {
    return { hit: false, stale: false, data: null, updatedAt: 0 }
  }
}

export function writeApiCache(userId, apiPath, data) {
  if (!hasWindow()) return
  const key = buildApiCacheKey(userId, apiPath)
  try {
    window.localStorage.setItem(key, JSON.stringify({
      updatedAt: Date.now(),
      data
    }))
  } catch {}
}

export function invalidateApiCache(userId, apiPath) {
  if (!hasWindow()) return
  const key = buildApiCacheKey(userId, apiPath)
  try {
    window.localStorage.removeItem(key)
  } catch {}
}

export function clearUserApiCaches(userId) {
  if (!hasWindow()) return
  const safeUserId = normalizePart(userId)
  if (!safeUserId) return
  const prefix = `${CACHE_PREFIX}:${safeUserId}:`
  try {
    const keys = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = String(window.localStorage.key(i) || '')
      if (key.startsWith(prefix)) keys.push(key)
    }
    keys.forEach(key => {
      try {
        window.localStorage.removeItem(key)
      } catch {}
    })
  } catch {}
}

export function clearCurrentUserApiCaches() {
  if (!hasWindow()) return
  const userId = getCachedUserId()
  if (userId) {
    clearUserApiCaches(userId)
  }
  try {
    window.localStorage.removeItem(USER_KEY)
  } catch {}
}
