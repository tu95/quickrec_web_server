import { createSupabaseServiceClient } from './supabase-client'

const USAGE_RPC = 'consume_recorder_quota'
const FEATURE_MEETING_NOTES = 'meeting_notes_generate'
const DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT = 10
const DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT_MESSAGE = '测试版美人人10次会议纪要生成功能'
const MISSING_USAGE_SCHEMA_ERROR = '缺少 recorder_usage_counters 表或 consume_recorder_quota 函数，请先在 Supabase 执行 web_server/supabase/schema.sql'

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

export function getNonAdminMeetingNotesLimit() {
  return normalizeLimit(process.env.NON_ADMIN_MEETING_NOTES_LIMIT)
}

export function getNonAdminMeetingNotesLimitMessage() {
  const fromEnv = String(process.env.NON_ADMIN_MEETING_NOTES_LIMIT_MESSAGE || '').trim()
  return fromEnv || DEFAULT_NON_ADMIN_MEETING_NOTES_LIMIT_MESSAGE
}

export async function consumeMeetingNotesQuota(userId, options = null) {
  const safeUserId = normalizeUserId(userId)
  if (!safeUserId) throw new Error('用户未登录')

  const limit = normalizeLimit(options?.limit || getNonAdminMeetingNotesLimit())
  const client = createSupabaseServiceClient()
  const { data, error } = await client.rpc(USAGE_RPC, {
    p_user_id: safeUserId,
    p_feature_key: FEATURE_MEETING_NOTES,
    p_limit: limit
  })
  if (error) {
    if (isMissingUsageSchemaError(error)) throw new Error(MISSING_USAGE_SCHEMA_ERROR)
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
    message: getNonAdminMeetingNotesLimitMessage()
  }
}
