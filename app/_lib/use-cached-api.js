'use client'

import { useEffect, useState } from 'react'
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
  const [cacheSnapshot, setCacheSnapshot] = useState({
    hit: false,
    stale: false,
    data: null,
    updatedAt: 0
  })

  useEffect(() => {
    if (!userId) return
    setCachedUserId(userId)
  }, [userId])

  const fallbackData = initialData !== undefined ? initialData : null

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

  useEffect(() => {
    if (!enabled || !safeApiPath || !effectiveCacheable || !safeUserId) {
      setCacheSnapshot({ hit: false, stale: false, data: null, updatedAt: 0 })
      return
    }
    const cached = readApiCache(safeUserId, safeApiPath, effectiveTtlMs)
    setCacheSnapshot(cached)
    if (cached.hit) {
      swr.mutate(cached.data, { revalidate: false }).catch(() => {})
    }
  }, [
    enabled,
    safeApiPath,
    safeUserId,
    effectiveTtlMs,
    effectiveCacheable,
    swr.mutate
  ])

  const showCachedOnError = Boolean(swr.error) && Boolean(cacheSnapshot.hit || fallbackData)

  return {
    ...swr,
    cacheMessage: showCachedOnError ? '同步失败，显示缓存' : '',
    cachedAt: cacheSnapshot.updatedAt || 0,
    clearCache: () => {
      if (!safeUserId) return
      invalidateApiCache(safeUserId, safeApiPath)
    },
    refresh: async () => {
      return swr.mutate()
    }
  }
}
