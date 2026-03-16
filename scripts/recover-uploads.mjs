#!/usr/bin/env node

/**
 * 手动补传 uploads/ 目录下的遗留文件
 *
 * 用法:
 *   npm run recover -- --status              # 查看遗留文件和 pending 任务状态
 *   npm run recover -- --lookup              # 查看最近活跃用户，帮助确认文件归属
 *   npm run recover -- --user-id <UUID>      # 为所有遗留文件创建待上传任务
 *   npm run recover -- --user-id <UUID> --file 20260313_21-22-40.mp3  # 只处理指定文件
 *   npm run recover -- --dry-run --user-id <UUID>  # 只预览，不写入
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()
const UPLOAD_DIR = path.join(ROOT, 'uploads')
const PENDING_FILE = path.join(UPLOAD_DIR, '.pending-jobs.json')
const AUDIO_EXTS = new Set(['.mp3', '.opus', '.wav', '.m4a', '.ogg'])
const SKIP_FILES = new Set(['.pending-jobs.json', '.gitkeep'])

// ── env 加载 ──

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(ROOT, name)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  }
}

function env(name) {
  return String(process.env[name] || '').trim()
}

function getSupabase() {
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，请检查 .env.local')
    process.exit(1)
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function maybeGetSupabase() {
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function isMissingTableError(error, tableName) {
  const code = String(error?.code || '').toUpperCase()
  const text = String(error?.message || error || '').toLowerCase()
  if (code === 'PGRST205' || code === 'PGRST202') return true
  return text.includes(String(tableName || '').toLowerCase()) && text.includes('could not find')
}

function toDisplayName(user) {
  const meta = user && typeof user.user_metadata === 'object' ? user.user_metadata : {}
  return String(meta.display_name || meta.name || '').trim()
}

async function lookupUserMapById(sb, userIds) {
  const out = {}
  for (const userId of userIds) {
    const uid = String(userId || '').trim()
    if (!uid) continue
    try {
      const { data, error } = await sb.auth.admin.getUserById(uid)
      if (error) {
        out[uid] = { email: '', display_name: '' }
        continue
      }
      const user = data?.user || null
      out[uid] = {
        email: String(user?.email || '').trim(),
        display_name: toDisplayName(user)
      }
    } catch {
      out[uid] = { email: '', display_name: '' }
    }
  }
  return out
}

async function queryRecentDeviceBindings(sb) {
  const { data, error } = await sb
    .from('recorder_user_devices')
    .select(`
      user_id,
      bound_at,
      status,
      device:recorder_devices (
        device_identity
      )
    `)
    .order('bound_at', { ascending: false })
    .limit(20)

  if (error) {
    if (isMissingTableError(error, 'recorder_user_devices')) {
      return { rows: [], source: 'missing_new_schema' }
    }
    throw error
  }
  return {
    source: 'recorder_schema',
    rows: (Array.isArray(data) ? data : []).map(item => ({
      user_id: String(item?.user_id || '').trim(),
      bound_at: item?.bound_at || '',
      status: String(item?.status || '').trim(),
      device_identity: String(item?.device?.device_identity || '').trim()
    }))
  }
}

async function queryLegacyDevices(sb) {
  const { data, error } = await sb
    .from('devices')
    .select('id, device_identity, user_id, bound_at, status')
    .order('bound_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return {
    source: 'legacy_schema',
    rows: (Array.isArray(data) ? data : []).map(item => ({
      user_id: String(item?.user_id || '').trim(),
      bound_at: item?.bound_at || '',
      status: String(item?.status || '').trim(),
      device_identity: String(item?.device_identity || '').trim()
    }))
  }
}

function buildPendingOwnerIndex(jobs) {
  const pendingFileSet = new Set()
  const ownerIndex = new Map()

  const addOwner = (fileName, userId) => {
    const name = String(fileName || '').trim()
    const uid = String(userId || '').trim()
    if (!name) return
    pendingFileSet.add(name)
    if (!uid) return
    const existing = ownerIndex.get(name) || new Set()
    existing.add(uid)
    ownerIndex.set(name, existing)
  }

  for (const j of jobs) {
    const localFileName = String(j?.localFileName || '').trim()
    const userId = String(j?.userId || '').trim()
    if (!localFileName) continue
    addOwner(localFileName, userId)

    if (localFileName.toLowerCase().endsWith('.opus')) {
      addOwner(localFileName.replace(/\.opus$/i, '.mp3'), userId)
    } else if (localFileName.toLowerCase().endsWith('.mp3')) {
      addOwner(localFileName.replace(/\.mp3$/i, '.opus'), userId)
    }
  }

  return {
    pendingFileSet,
    ownerIndex
  }
}

function formatUserDetails(userId, userMap) {
  const uid = String(userId || '').trim()
  if (!uid) return 'user_id: (无)'
  const user = userMap && typeof userMap === 'object' ? (userMap[uid] || {}) : {}
  const email = user.email || '(无邮箱)'
  const name = user.display_name || '(无用户名)'
  return `user_id: ${uid}  email: ${email}  name: ${name}`
}

async function loadUserMapForStatus(userIds) {
  const ids = [...new Set((userIds || []).map(v => String(v || '').trim()).filter(Boolean))]
  if (ids.length === 0) return { userMap: {}, warning: '' }

  const sb = maybeGetSupabase()
  if (!sb) {
    return {
      userMap: {},
      warning: '未配置 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，无法显示邮箱/用户名。'
    }
  }

  const userMap = await lookupUserMapById(sb, ids)
  const foundCount = ids.filter(id => String(userMap[id]?.email || '').trim() || String(userMap[id]?.display_name || '').trim()).length
  if (foundCount === 0) {
    return {
      userMap,
      warning: '用户信息查询为空（可能是网络问题、Service Role 权限不足，或用户已不存在）。'
    }
  }
  return { userMap, warning: '' }
}

// ── lookup: 查最近活跃用户 ──

async function lookupRecentUsers() {
  const sb = getSupabase()
  console.log('\n查询最近 24 小时内有设备活动的用户...\n')

  let result = await queryRecentDeviceBindings(sb)
  if (result.source === 'missing_new_schema') {
    result = await queryLegacyDevices(sb)
  }

  const devices = Array.isArray(result.rows) ? result.rows : []
  if (devices.length === 0) {
    console.log('没有找到设备记录。')
    return
  }

  const userIds = [...new Set(devices.map(d => d.user_id).filter(Boolean))]
  const userMap = userIds.length > 0 ? await lookupUserMapById(sb, userIds) : {}

  const sourceText = result.source === 'legacy_schema' ? 'legacy devices 表' : 'recorder_user_devices 表'
  console.log(`最近设备绑定记录（来源: ${sourceText}）:`)
  console.log('-'.repeat(100))
  for (const d of devices) {
    const user = userMap[d.user_id] || {}
    const email = user.email || '(无邮箱)'
    const name = user.display_name || ''
    const time = d.bound_at ? new Date(d.bound_at).toLocaleString('zh-CN') : '-'
    console.log(
      `  user_id: ${d.user_id}  |  email: ${email}  |  name: ${name}  |  device: ${d.device_identity}  |  bound: ${time}  |  status: ${d.status}`
    )
  }
  console.log('-'.repeat(100))
  console.log('\n找到目标用户后，运行:')
  console.log('  npm run recover -- --user-id <上面的 user_id>\n')
}

// ── 扫描遗留文件 ──

function scanOrphanFiles(filterFile) {
  if (!fs.existsSync(UPLOAD_DIR)) return []
  const entries = fs.readdirSync(UPLOAD_DIR)
  const results = []
  for (const name of entries) {
    if (SKIP_FILES.has(name)) continue
    if (name.startsWith('.')) continue
    const ext = path.extname(name).toLowerCase()
    if (!AUDIO_EXTS.has(ext)) continue
    if (filterFile && name !== filterFile) continue
    const fullPath = path.join(UPLOAD_DIR, name)
    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) continue
    results.push({ name, size: stat.size, mtime: stat.mtimeMs })
  }
  return results.sort((a, b) => b.mtime - a.mtime)
}

// ── pending jobs 读写 ──

function readPendingStore() {
  try {
    const raw = fs.readFileSync(PENDING_FILE, 'utf8')
    const data = JSON.parse(raw)
    return (data && typeof data.jobs === 'object') ? data.jobs : {}
  } catch {
    return {}
  }
}

function writePendingStore(jobs) {
  const data = { updatedAt: Date.now(), jobs }
  const tmp = `${PENDING_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, PENDING_FILE)
}

// ── status: 查看遗留文件和 pending 任务 ──

async function showStatus() {
  const orphans = scanOrphanFiles()
  const store = readPendingStore()
  const jobs = Object.values(store)
  const { pendingFileSet, ownerIndex } = buildPendingOwnerIndex(jobs)
  const ownerUserIds = new Set()
  for (const ids of ownerIndex.values()) {
    for (const uid of ids) ownerUserIds.add(String(uid || '').trim())
  }
  for (const j of jobs) {
    const uid = String(j?.userId || '').trim()
    if (uid) ownerUserIds.add(uid)
  }
  const { userMap, warning } = await loadUserMapForStatus([...ownerUserIds])

  console.log('\n═══ uploads/ 遗留文件 ═══\n')
  if (orphans.length === 0) {
    console.log('  (无遗留音频文件)')
  } else {
    for (const f of orphans) {
      const kb = (f.size / 1024).toFixed(1)
      const time = new Date(f.mtime).toLocaleString('zh-CN')
      const tracked = pendingFileSet.has(f.name) ? ' [已记录]' : ' [未记录]'
      const owners = [...(ownerIndex.get(f.name) || [])]
      const ownerText = owners.length > 0
        ? `  owner: ${owners.map(uid => formatUserDetails(uid, userMap)).join(' ; ')}`
        : ''
      console.log(`  ${f.name}  (${kb} KB, ${time})${tracked}${ownerText}`)
    }
  }

  console.log('\n═══ .pending-jobs.json 任务队列 ═══\n')
  if (jobs.length === 0) {
    console.log('  (无 pending 任务)')
  } else {
    const grouped = { queued: [], running: [], failed: [], success: [] }
    for (const j of jobs) {
      const key = grouped[j.status] ? j.status : 'queued'
      grouped[key].push(j)
    }
    for (const [status, list] of Object.entries(grouped)) {
      if (list.length === 0) continue
      console.log(`  [${status}] ${list.length} 个:`)
      for (const j of list) {
        const time = j.queuedAt ? new Date(j.queuedAt).toLocaleString('zh-CN') : '-'
        const userText = formatUserDetails(j.userId, userMap)
        const errText = j.error ? `  err: ${String(j.error).slice(0, 60)}` : ''
        console.log(`    ${j.id}  file: ${j.localFileName}  ${userText}  queued: ${time}  attempt: ${j.attempt || 0}/${j.maxRetries || 3}${errText}`)
      }
    }
  }

  if (warning) {
    console.log(`\n[提示] ${warning}`)
  }

  // 汇总
  const untrackedCount = orphans.filter(f => !pendingFileSet.has(f.name)).length
  console.log('\n═══ 汇总 ═══\n')
  console.log(`  磁盘遗留文件: ${orphans.length}`)
  console.log(`  pending 任务: ${jobs.length} (queued: ${jobs.filter(j=>j.status==='queued').length}, running: ${jobs.filter(j=>j.status==='running').length}, failed: ${jobs.filter(j=>j.status==='failed').length})`)
  console.log(`  未记录文件:   ${untrackedCount}`)

  if (untrackedCount > 0) {
    console.log('\n有未记录的文件，可用以下命令补录:')
    console.log('  npm run recover:lookup                            # 先查用户')
    console.log('  npm run recover -- --user-id <UUID>               # 再补传')
  }
  if (jobs.filter(j => j.status === 'failed' || j.status === 'queued').length > 0) {
    console.log('\n有待恢复的任务，重启服务后下次 upload-chunk 请求会自动触发恢复。')
  }
  console.log('')
}

// ── 主入口 ──

function main() {
  loadEnv()

  const args = process.argv.slice(2)
  const flagIndex = (flag) => args.indexOf(flag)
  const hasFlag = (flag) => flagIndex(flag) !== -1
  const flagValue = (flag) => {
    const idx = flagIndex(flag)
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : ''
  }

  if (hasFlag('--status')) {
    showStatus().catch(err => {
      console.error('status 出错:', err.message)
      process.exit(1)
    })
    return
  }

  if (hasFlag('--lookup')) {
    lookupRecentUsers().catch(err => {
      console.error('lookup 出错:', err.message)
      process.exit(1)
    })
    return
  }

  const userId = flagValue('--user-id')
  if (!userId) {
    console.log('用法:')
    console.log('  npm run recover:status                                  # 查看状态')
    console.log('  npm run recover:lookup                                  # 查看最近用户')
    console.log('  npm run recover -- --user-id <UUID>                     # 补传所有遗留文件')
    console.log('  npm run recover -- --user-id <UUID> --file <name>      # 补传指定文件')
    console.log('  npm run recover -- --user-id <UUID> --dry-run          # 预览不执行')
    process.exit(0)
  }

  const filterFile = flagValue('--file')
  const dryRun = hasFlag('--dry-run')
  const orphans = scanOrphanFiles(filterFile)

  if (orphans.length === 0) {
    console.log(filterFile
      ? `uploads/ 下没找到文件: ${filterFile}`
      : 'uploads/ 下没有遗留的音频文件。'
    )
    process.exit(0)
  }

  console.log(`\n找到 ${orphans.length} 个遗留文件:\n`)
  for (const f of orphans) {
    const kb = (f.size / 1024).toFixed(1)
    const time = new Date(f.mtime).toLocaleString('zh-CN')
    console.log(`  ${f.name}  (${kb} KB, ${time})`)
  }

  const store = readPendingStore()
  let added = 0
  for (const f of orphans) {
    const existing = Object.values(store).find(
      j => j.localFileName === f.name && j.status !== 'success'
    )
    if (existing) {
      console.log(`  ⏭ ${f.name} 已在 pending 队列中 (${existing.id})`)
      continue
    }
    const jobId = `recover_${Date.now()}_${Math.floor(Math.random() * 1000000)}`
    store[jobId] = {
      id: jobId,
      uploadId: `manual_recover_${f.name}`,
      userId,
      deviceDbId: '',
      deviceIdentity: 'manual_recover',
      localFileName: f.name,
      queuedAt: Date.now(),
      attempt: 0,
      maxRetries: 3,
      error: '',
      status: 'queued'
    }
    added += 1
    console.log(`  + ${f.name} → ${jobId}`)
  }

  if (added === 0) {
    console.log('\n没有新文件需要添加。')
    process.exit(0)
  }

  if (dryRun) {
    console.log(`\n[dry-run] 共 ${added} 个任务，未实际写入。去掉 --dry-run 执行。`)
    process.exit(0)
  }

  writePendingStore(store)
  console.log(`\n已写入 ${added} 个任务到 ${PENDING_FILE}`)
  console.log('服务重启后（或下次有 upload-chunk 请求时）会自动恢复上传。')
  console.log('如需立刻触发，可执行: curl -s -X POST http://localhost:3000/api/watch/upload-chunk | head -c 200\n')
}

main()
