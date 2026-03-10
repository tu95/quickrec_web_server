#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createClient } from '@supabase/supabase-js'

const ROOT_DIR = path.resolve(process.cwd())
const ENV_LOCAL_PATH = path.join(ROOT_DIR, '.env.local')
const FEATURE_KEY = 'meeting_notes_generate'
const DEFAULT_LIMIT_FALLBACK = 5
const USER_LIMITS_TABLE = 'recorder_user_quota_limits'
const USAGE_TABLE = 'recorder_usage_counters'

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const text = fs.readFileSync(filePath, 'utf8')
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = String(rawLine || '').trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function pickEnv(key, parsed) {
  return String(process.env[key] || parsed[key] || '').trim()
}

function toDateText(raw) {
  const text = String(raw || '').trim()
  if (!text) return '-'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString('zh-CN')
}

function toInt(raw, fallback = 0) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function clampLimit(raw) {
  const n = toInt(raw, DEFAULT_LIMIT_FALLBACK)
  if (n < 1) return 1
  if (n > 1000000) return 1000000
  return n
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase()
}

function getDisplayName(user) {
  const meta = user && typeof user.user_metadata === 'object' ? user.user_metadata : {}
  const name = String(meta.display_name || meta.name || '').trim()
  return name || '-'
}

function isMissingTableError(error, tableName) {
  const code = String(error?.code || '').toUpperCase()
  const text = String(error?.message || error || '').toLowerCase()
  if (code === 'PGRST205' || code === 'PGRST202') return true
  return text.includes(String(tableName || '').toLowerCase()) && text.includes('could not find')
}

function toErrorText(error) {
  const text = String(error?.message || error || '').trim()
  if (!text) return '未知错误'
  if (text.includes('fetch failed')) {
    return '网络连接 Supabase 失败（fetch failed），请检查网络或稍后重试'
  }
  return text
}

async function listAllUsers(admin) {
  let page = 1
  const perPage = 200
  const all = []
  while (true) {
    const { data, error } = await admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers 失败: ${String(error.message || error)}`)
    const users = Array.isArray(data?.users) ? data.users : []
    all.push(...users)
    if (users.length < perPage) break
    page += 1
    if (page > 500) break
  }
  return all
}

async function findUserByEmail(admin, email) {
  const target = normalizeEmail(email)
  if (!target) return null
  let page = 1
  const perPage = 200
  while (true) {
    const { data, error } = await admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers 失败: ${String(error.message || error)}`)
    const users = Array.isArray(data?.users) ? data.users : []
    const found = users.find(item => normalizeEmail(item?.email) === target)
    if (found) return found
    if (users.length < perPage) break
    page += 1
    if (page > 500) break
  }
  return null
}

async function getQuotaInfo(client, userId, defaultLimit) {
  const fallbackLimit = clampLimit(defaultLimit)
  const out = {
    limit: fallbackLimit,
    usedCount: 0,
    remaining: fallbackLimit,
    source: 'default'
  }

  const { data: limitData, error: limitError } = await client
    .from(USER_LIMITS_TABLE)
    .select('quota_limit')
    .eq('user_id', String(userId))
    .eq('feature_key', FEATURE_KEY)
    .maybeSingle()

  if (limitError && !isMissingTableError(limitError, USER_LIMITS_TABLE)) {
    throw new Error(`查询用户配额失败: ${String(limitError.message || limitError)}`)
  }
  if (limitData && Number.isFinite(Number(limitData.quota_limit))) {
    out.limit = clampLimit(limitData.quota_limit)
    out.source = 'override'
  }

  const { data: usageData, error: usageError } = await client
    .from(USAGE_TABLE)
    .select('used_count')
    .eq('user_id', String(userId))
    .eq('feature_key', FEATURE_KEY)
    .maybeSingle()

  if (usageError && !isMissingTableError(usageError, USAGE_TABLE)) {
    throw new Error(`查询已使用次数失败: ${String(usageError.message || usageError)}`)
  }
  out.usedCount = toInt(usageData?.used_count, 0)
  out.remaining = Math.max(out.limit - out.usedCount, 0)
  return out
}

async function addQuotaByEmail(client, admin, email, delta, defaultLimit) {
  const user = await findUserByEmail(admin, email)
  if (!user) {
    throw new Error(`未找到用户: ${email}`)
  }
  const userId = String(user.id || '').trim()
  if (!userId) throw new Error('用户 ID 为空，无法更新配额')

  const before = await getQuotaInfo(client, userId, defaultLimit)
  const increase = clampLimit(delta)
  const afterLimit = clampLimit(before.limit + increase)

  const { error } = await client
    .from(USER_LIMITS_TABLE)
    .upsert(
      {
        user_id: userId,
        feature_key: FEATURE_KEY,
        quota_limit: afterLimit,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id,feature_key' }
    )

  if (error) {
    if (isMissingTableError(error, USER_LIMITS_TABLE)) {
      throw new Error('缺少 recorder_user_quota_limits 表，请先执行 web_server/supabase/schema.sql')
    }
    throw new Error(`更新配额失败: ${String(error.message || error)}`)
  }

  const after = await getQuotaInfo(client, userId, defaultLimit)
  return {
    user,
    before,
    after,
    increase
  }
}

function printMenu() {
  console.log('\n=== Supabase Manager ===')
  console.log('1) 查看 Supabase 用户数量')
  console.log('2) 查看所有用户（邮箱/用户名/注册时间/最近登录）')
  console.log('3) 给指定用户（邮箱）增加纪要生成数量')
  console.log('4) 查看指定用户信息（邮箱）')
  console.log('5) 退出')
}

async function main() {
  const parsedEnv = parseEnvFile(ENV_LOCAL_PATH)
  const supabaseUrl = pickEnv('SUPABASE_URL', parsedEnv)
  const serviceRoleKey = pickEnv('SUPABASE_SERVICE_ROLE_KEY', parsedEnv)
  const defaultLimit = clampLimit(pickEnv('NON_ADMIN_MEETING_NOTES_LIMIT', parsedEnv) || DEFAULT_LIMIT_FALLBACK)

  if (!supabaseUrl) throw new Error('缺少 SUPABASE_URL（请在 .env.local 配置）')
  if (!serviceRoleKey) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY（请在 .env.local 配置）')

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const admin = client.auth.admin
  const rl = readline.createInterface({ input, output })

  try {
    while (true) {
      printMenu()
      const choice = String(await rl.question('请选择 [1-5]: ')).trim()

      if (choice === '5') {
        console.log('已退出。')
        break
      }

      try {
        if (choice === '1') {
          const users = await listAllUsers(admin)
          console.log(`\n用户总数: ${users.length}`)
          continue
        }

        if (choice === '2') {
          const users = await listAllUsers(admin)
          const rows = users
            .map((user, index) => ({
              '#': index + 1,
              email: String(user?.email || '-'),
              username: getDisplayName(user),
              created_at: toDateText(user?.created_at),
              last_sign_in_at: toDateText(user?.last_sign_in_at)
            }))
          console.log(`\n共 ${rows.length} 个用户`)
          if (rows.length > 0) {
            console.table(rows)
          }
          continue
        }

        if (choice === '3') {
          const email = String(await rl.question('请输入用户邮箱: ')).trim()
          const deltaRaw = String(await rl.question('请输入增加次数(正整数): ')).trim()
          const delta = toInt(deltaRaw, 0)
          if (!email) {
            console.log('邮箱不能为空。')
            continue
          }
          if (!Number.isFinite(delta) || delta <= 0) {
            console.log('增加次数必须是正整数。')
            continue
          }
          const result = await addQuotaByEmail(client, admin, email, delta, defaultLimit)
          console.log('\n更新成功:')
          console.table([{
            email: String(result.user?.email || '-'),
            before_limit: result.before.limit,
            increase: result.increase,
            after_limit: result.after.limit,
            used_count: result.after.usedCount,
            remaining: result.after.remaining
          }])
          continue
        }

        if (choice === '4') {
          const email = String(await rl.question('请输入用户邮箱: ')).trim()
          if (!email) {
            console.log('邮箱不能为空。')
            continue
          }
          const user = await findUserByEmail(admin, email)
          if (!user) {
            console.log(`未找到用户: ${email}`)
            continue
          }
          const quota = await getQuotaInfo(client, String(user.id || ''), defaultLimit)
          console.table([{
            email: String(user?.email || '-'),
            username: getDisplayName(user),
            user_id: String(user?.id || '-'),
            created_at: toDateText(user?.created_at),
            last_sign_in_at: toDateText(user?.last_sign_in_at),
            quota_source: quota.source,
            quota_limit: quota.limit,
            quota_used: quota.usedCount,
            quota_remaining: quota.remaining
          }])
          continue
        }

        console.log('无效选项，请输入 1-5。')
      } catch (error) {
        console.log(`操作失败: ${toErrorText(error)}`)
      }
    }
  } finally {
    rl.close()
  }
}

main().catch(error => {
  const text = String(error?.message || error || '')
  if (text.includes('readline was closed')) {
    console.log('[manager] stdin 已关闭，退出。')
    process.exitCode = 0
    return
  }
  console.error('[manager] failed:', toErrorText(error))
  process.exitCode = 1
})
