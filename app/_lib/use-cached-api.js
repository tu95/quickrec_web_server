'use client'

import { useEffect, useMemo } from 'react'
import useSWR from 'swr'
import {
  getCachedUserId,
  invalidateApiCache,
  readApiCache,
  setCachedUserId,
  writeApiCache
} from './client-cache'
import { getApiCachePolicy } from './cache-policy'

function normalizeUserId(rawUserId, allowUserIdFallback) {
  const explicit = String(rawUserId || '').trim()
  if (explicit) return explicit
  if (!allowUserIdFallback) return ''
  const cached = getCachedUserId()
  if (cached) return cached
  return 'anonymous'
}

function normalizeErrorMessage(payload, status) {
  const bodyError = String(payload?.error || payload?.message || '').trim()
  if (bodyError) return bodyError
  return `HTTP ${status}`
}

export function useCachedApi({
  apiPath,
  userId,
  ttlMs,
  cacheable,
  enabled = true,
  allowUserIdFallback = true,
  initialData = null,
  successGuard = null,
  fetchInit = null,
  dedupingInterval = 2000
}) {
  const safeApiPath = String(apiPath || '').trim()
  const policy = getApiCachePolicy(safeApiPath)
  const safeUserId = normalizeUserId(userId, allowUserIdFallback)
  const effectiveTtlMs = Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : Number(policy.ttlMs || 0)
  const effectiveCacheable = typeof cacheable === 'boolean' ? cacheable : Boolean(policy.cacheable)

  useEffect(() => {
    if (!userId) return
    setCachedUserId(userId)
  }, [userId])

  const cached = useMemo(() => {
    if (!effectiveCacheable) return { hit: false, stale: false, data: null }
    if (!safeApiPath || !enabled) return { hit: false, stale: false, data: null }
    if (!safeUserId) return { hit: false, stale: false, data: null }
    return readApiCache(safeUserId, safeApiPath, effectiveTtlMs)
  }, [safeApiPath, safeUserId, effectiveTtlMs, enabled, effectiveCacheable])

  const fallbackData = cached.hit
    ? cached.data
    : (initialData !== undefined ? initialData : null)

  const swr = useSWR(
    enabled && safeApiPath ? ['api-cache', safeUserId, safeApiPath] : null,
    async () => {
      const res = await fetch(safeApiPath, {
        cache: 'no-store',
        ...(fetchInit || {})
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(normalizeErrorMessage(payload, res.status))
        error.status = res.status
        throw error
      }
      if (typeof successGuard === 'function' && !successGuard(payload)) {
        throw new Error(normalizeErrorMessage(payload, res.status))
      }
      return payload
    },
    {
      fallbackData,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval,
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryInterval: 2500,
      errorRetryCount: 2,
      onSuccess: (data) => {
        if (!effectiveCacheable) return
        if (!safeUserId) return
        writeApiCache(safeUserId, safeApiPath, data)
      }
    }
  )

  const showCachedOnError = Boolean(swr.error) && Boolean(cached.hit || fallbackData)

  return {
    ...swr,
    cacheMessage: showCachedOnError ? '同步失败，显示缓存' : '',
    cachedAt: cached.updatedAt || 0,
    clearCache: () => {
      if (!safeUserId) return
      invalidateApiCache(safeUserId, safeApiPath)
    },
    refresh: async () => {
      return swr.mutate()
    }
  }
}
