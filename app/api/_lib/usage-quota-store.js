import { createSupabaseServiceClient } from './supabase-client'

const USAGE_RPC = 'consume_recorder_quota'
const REFUND_USAGE_RPC = 'refund_recorder_quota'
const FEATURE_MEETING_NOTES = 'meeting_notes_generate'
const USER_QUOTA_LIMITS_TABLE = 'recorder_user_quota_limits'
const DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT = 5
const DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT_MESSAGE = '测试版每人赠送5次会议纪要生成功能'
const MISSING_USAGE_SCHEMA_ERROR = '缺少 recorder_usage_counters 表或 consume_recorder_quota 函数，请先在 Supabase 执行 web_server/supabase/schema.sql'
const BROKEN_USAGE_RPC_ERROR = 'consume_recorder_quota 函数存在 used_count 歧义，请在 Supabase 重新执行 web_server/supabase/schema.sql'

function normalizeUserId(raw) {
  return String(raw || '').trim()
}

function normalizeLimit(rawLimit) {
  const value = Number(rawLimit)
  if (!Number.isFinite(value)) return DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT
  const rounded = Math.floor(value)
  if (rounded < 1) return 1
  if (rounded > 1000000) return 1000000
  return rounded
}

function firstRow(data) {
  if (Array.isArray(data) && data.length > 0) return data[0]
  if (data && typeof data === 'object') return data
  return null
}

function toNumber(raw, fallback = 0) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return value
}

function toBoolean(raw) {
  if (typeof raw === 'boolean') return raw
  const text = String(raw || '').trim().toLowerCase()
  return text === 'true' || text === '1' || text === 't'
}

function isMissingUsageSchemaError(error) {
  const code = String(error?.code || '').toUpperCase()
  if (code === 'PGRST202' || code === 'PGRST205') return true
  const text = String(error?.message || error || '').toLowerCase()
  return (
    (text.includes('consume_recorder_quota') && text.includes('could not find')) ||
    (text.includes('recorder_usage_counters') && text.includes('could not find')) ||
    (text.includes('consume_recorder_quota') && text.includes('does not exist')) ||
    (text.includes('recorder_usage_counters') && text.includes('does not exist'))
  )
}

function isMissingQuotaOverridesSchemaError(error) {
  const code = String(error?.code || '').toUpperCase()
  if (code === 'PGRST202' || code === 'PGRST205') return true
  const text = String(error?.message || error || '').toLowerCase()
  return (
    (text.includes(USER_QUOTA_LIMITS_TABLE) && text.includes('could not find')) ||
    (text.includes(USER_QUOTA_LIMITS_TABLE) && text.includes('does not exist'))
  )
}

function isAmbiguousUsageColumnError(error) {
  const code = String(error?.code || '').toUpperCase()
  if (code === '42702') return true
  const text = String(error?.message || error || '').toLowerCase()
  return (
    text.includes('column reference') &&
    text.includes('used_count') &&
    text.includes('ambiguous')
  )
}

// 这个函数主要是把任意 used_count 值转成安全整数。
function normalizeUsedCount(rawCount) {
  const value = toNumber(rawCount, 0)
  if (value <= 0) return 0
  return Math.floor(value)
}

// 这个函数主要是读取当前功能的已用次数。
async function getFeatureUsageCount(userId, featureKey) {
  const safeUserId = normalizeUserId(userId)
  const safeFeatureKey = String(featureKey || '').trim()
  if (!safeUserId || !safeFeatureKey) throw new Error('配额查询参数无效')

  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from('recorder_usage_counters')
    .select('used_count')
    .eq('user_id', safeUserId)
    .eq('feature_key', safeFeatureKey)
    .maybeSingle()

  if (error) {
    if (isMissingUsageSchemaError(error)) throw new Error(MISSING_USAGE_SCHEMA_ERROR)
    throw new Error(String(error.message || '配额查询失败'))
  }
  return normalizeUsedCount(data?.used_count)
}

export function getNonAdminMeetingNotesLimit() {
  return normalizeLimit(process.env.NON_ADMIN_MEETING_NOTES_LIMIT)
}

export function getNonAdminMeetingNotesLimitMessage(limit = getNonAdminMeetingNotesLimit()) {
  const fromEnv = String(process.env.NON_ADMIN_MEETING_NOTES_LIMIT_MESSAGE || '').trim()
  if (fromEnv) return fromEnv
  const safeLimit = normalizeLimit(limit)
  if (safeLimit === DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT) {
    return DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT_MESSAGE
  }
  return `测试版每人赠送${safeLimit}次会议纪要生成功能`
}

async function resolveMeetingNotesLimit(userId, options = null) {
  const safeUserId = normalizeUserId(userId)
  if (!safeUserId) throw new Error('用户未登录')
  const fallbackLimit = normalizeLimit(options?.limit || getNonAdminMeetingNotesLimit())

  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(USER_QUOTA_LIMITS_TABLE)
    .select('quota_limit')
    .eq('user_id', safeUserId)
    .eq('feature_key', FEATURE_MEETING_NOTES)
    .maybeSingle()
  if (error) {
    if (isMissingQuotaOverridesSchemaError(error)) return fallbackLimit
    throw new Error(String(error.message || '配额配置查询失败'))
  }

  const customLimit = Number(data?.quota_limit)
  if (!Number.isFinite(customLimit)) return fallbackLimit
  return normalizeLimit(customLimit)
}

export async function getMeetingNotesQuotaStatus(userId, options = null) {
  const safeUserId = normalizeUserId(userId)
  if (!safeUserId) throw new Error('用户未登录')

  const limit = await resolveMeetingNotesLimit(safeUserId, options)
  const usedCount = await getFeatureUsageCount(safeUserId, FEATURE_MEETING_NOTES)
  const remaining = Math.max(limit - usedCount, 0)
  return {
    allowed: remaining > 0,
    usedCount,
    remaining,
    limit,
    message: getNonAdminMeetingNotesLimitMessage(limit)
  }
}

export async function consumeMeetingNotesQuota(userId, options = null) {
  const safeUserId = normalizeUserId(userId)
  if (!safeUserId) throw new Error('用户未登录')

  const limit = await resolveMeetingNotesLimit(safeUserId, options)
  const client = createSupabaseServiceClient()
  const { data, error } = await client.rpc(USAGE_RPC, {
    p_user_id: safeUserId,
    p_feature_key: FEATURE_MEETING_NOTES,
    p_limit: limit
  })
  if (error) {
    if (isMissingUsageSchemaError(error)) throw new Error(MISSING_USAGE_SCHEMA_ERROR)
    if (isAmbiguousUsageColumnError(error)) throw new Error(BROKEN_USAGE_RPC_ERROR)
    throw new Error(String(error.message || '配额校验失败'))
  }

  const row = firstRow(data)
  if (!row) throw new Error('配额校验失败：返回空结果')

  const allowed = toBoolean(row.allowed)
  const usedCount = toNumber(row.used_count, 0)
  const remaining = toNumber(row.remaining, Math.max(0, limit - usedCount))
  return {
    allowed,
    usedCount,
    remaining,
    limit,
    message: getNonAdminMeetingNotesLimitMessage(limit)
  }
}

// 这个函数主要是在建任务失败后回退一次纪要额度。
export async function refundMeetingNotesQuota(userId, options = null) {
  const safeUserId = normalizeUserId(userId)
  if (!safeUserId) throw new Error('用户未登录')

  const limit = await resolveMeetingNotesLimit(safeUserId, options)
  const client = createSupabaseServiceClient()
  const { data, error } = await client.rpc(REFUND_USAGE_RPC, {
    p_user_id: safeUserId,
    p_feature_key: FEATURE_MEETING_NOTES
  })
  if (error) {
    if (isMissingUsageSchemaError(error)) throw new Error(MISSING_USAGE_SCHEMA_ERROR)
    throw new Error(String(error.message || '配额回退失败'))
  }

  const row = firstRow(data)
  const usedCount = normalizeUsedCount(row?.used_count)
  const remaining = Math.max(limit - usedCount, 0)
  return {
    allowed: remaining > 0,
    usedCount,
    remaining,
    limit,
    message: getNonAdminMeetingNotesLimitMessage(limit)
  }
}
