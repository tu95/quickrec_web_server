const DEFAULT_TTL_MS = 30 * 1000

const POLICY_TABLE = [
  { match: '/api/files', ttlMs: 45 * 1000, cacheable: true },
  { match: '/api/user/devices', ttlMs: 60 * 1000, cacheable: true },
  { match: '/api/user/quota/meeting-notes', ttlMs: 20 * 1000, cacheable: true },
  { match: '/api/user-auth/me', ttlMs: 30 * 1000, cacheable: true },
  { match: '/api/user/config-profiles', ttlMs: 60 * 1000, cacheable: true },
  { match: '/api/admin/config-profiles', ttlMs: 60 * 1000, cacheable: true },
  // 轮询/任务状态不缓存，避免状态延迟
  { match: '/api/meeting-notes/jobs/', ttlMs: 0, cacheable: false },
  // 测试连通性接口不缓存，避免误判
  { match: '/api/user/llm/test', ttlMs: 0, cacheable: false },
  { match: '/api/admin/llm/test', ttlMs: 0, cacheable: false },
  { match: '/api/user/aliyun/asr/test', ttlMs: 0, cacheable: false },
  { match: '/api/admin/aliyun/asr/test', ttlMs: 0, cacheable: false },
  { match: '/api/user/aliyun/oss/test', ttlMs: 0, cacheable: false },
  { match: '/api/admin/aliyun/oss/test', ttlMs: 0, cacheable: false }
]

function normalizePath(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  const q = text.indexOf('?')
  return q >= 0 ? text.slice(0, q) : text
}

export function getApiCachePolicy(apiPath) {
  const path = normalizePath(apiPath)
  if (!path) {
    return { ttlMs: DEFAULT_TTL_MS, cacheable: true }
  }
  const exact = POLICY_TABLE.find(item => item.match === path)
  if (exact) {
    return { ttlMs: exact.ttlMs, cacheable: exact.cacheable !== false }
  }
  const prefix = POLICY_TABLE.find(item => path.startsWith(String(item.match || '')))
  if (prefix) {
    return { ttlMs: prefix.ttlMs, cacheable: prefix.cacheable !== false }
  }
  return { ttlMs: DEFAULT_TTL_MS, cacheable: true }
}
