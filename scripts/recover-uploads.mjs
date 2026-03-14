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

// ── lookup: 查最近活跃用户 ──

async function lookupRecentUsers() {
  const sb = getSupabase()
  console.log('\n查询最近 24 小时内有设备活动的用户...\n')

  const { data: devices, error } = await sb
    .from('devices')
    .select('id, device_identity, user_id, bound_at, status')
    .order('bound_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('查询失败:', error.message)
    return
  }
  if (!devices || devices.length === 0) {
    console.log('没有找到设备记录。')
    return
  }

  const userIds = [...new Set(devices.map(d => d.user_id).filter(Boolean))]
  let userMap = {}
  if (userIds.length > 0) {
    const { data: profiles } = await sb
      .from('user_profiles')
      .select('id, email, display_name')
      .in('id', userIds)
    if (profiles) {
      for (const p of profiles) userMap[p.id] = p
    }
  }

  console.log('最近设备绑定记录:')
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

function showStatus() {
  const orphans = scanOrphanFiles()
  const store = readPendingStore()
  const jobs = Object.values(store)
  const pendingFileSet = new Set(jobs.map(j => j.localFileName))

  console.log('\n═══ uploads/ 遗留文件 ═══\n')
  if (orphans.length === 0) {
    console.log('  (无遗留音频文件)')
  } else {
    for (const f of orphans) {
      const kb = (f.size / 1024).toFixed(1)
      const time = new Date(f.mtime).toLocaleString('zh-CN')
      const tracked = pendingFileSet.has(f.name) ? ' [已记录]' : ' [未记录]'
      console.log(`  ${f.name}  (${kb} KB, ${time})${tracked}`)
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
        const userShort = String(j.userId || '').slice(0, 8) || '(无)'
        const errText = j.error ? `  err: ${String(j.error).slice(0, 60)}` : ''
        console.log(`    ${j.id}  file: ${j.localFileName}  user: ${userShort}..  queued: ${time}  attempt: ${j.attempt || 0}/${j.maxRetries || 3}${errText}`)
      }
    }
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
    showStatus()
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
