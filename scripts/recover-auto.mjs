#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const FINAL_STATUS = new Set(['success', 'failed', 'missing'])

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function pickArgValue(args, flag) {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return ''
  return String(args[idx + 1] || '').trim()
}

function toInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function nowText() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function safeText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

function printJobUpdate(job) {
  const id = safeText(job.id)
  const file = safeText(job.outputFileName || job.localFileName || job.inputFileName)
  const userId = safeText(job.userId)
  const status = safeText(job.status)
  const attempt = Number(job.attempt || 0)
  const maxRetries = Number(job.maxRetries || 0)
  const base = `[${nowText()}] ${id}  ${status}  file: ${file}  user: ${userId}  attempt: ${attempt}/${maxRetries}`
  if (status === 'failed') {
    console.log(`${base}  err: ${safeText(job.error, '(无)')}`)
    return
  }
  if (status === 'success') {
    console.log(`${base}  objectKey: ${safeText(job.objectKey)}`)
    return
  }
  console.log(base)
}

function summarizeFinal(jobs, timeoutReached) {
  const success = jobs.filter(j => j.status === 'success')
  const failed = jobs.filter(j => j.status === 'failed' || j.status === 'missing')
  const unfinished = jobs.filter(j => !FINAL_STATUS.has(String(j.status || '')))

  console.log('\n═══ 恢复结果汇总 ═══\n')
  console.log(`  success: ${success.length}`)
  console.log(`  failed: ${failed.length}`)
  console.log(`  unfinished: ${unfinished.length}`)

  if (failed.length > 0) {
    console.log('\n失败任务:')
    for (const j of failed) {
      const err = safeText(j.error, j.status === 'missing' ? '任务不存在' : '(无)')
      console.log(`  ${safeText(j.id)}  file: ${safeText(j.outputFileName || j.localFileName || j.inputFileName)}  err: ${err}`)
    }
  }
  if (unfinished.length > 0) {
    console.log('\n未完成任务:')
    for (const j of unfinished) {
      console.log(`  ${safeText(j.id)}  status: ${safeText(j.status)}  attempt: ${Number(j.attempt || 0)}/${Number(j.maxRetries || 0)}`)
    }
  }
  if (timeoutReached) {
    console.log('\n[警告] 已达到超时时间，仍有任务未完成。')
  }
}

function normalizeOrigin(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  return text.replace(/\/+$/, '')
}

function buildHeaders(token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers['x-admin-settings-token'] = token
  return headers
}

async function postJson(url, payload, token) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(payload || {})
  })
  let data = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }
  if (!resp.ok) {
    const errText = data?.error ? String(data.error) : `${resp.status} ${resp.statusText}`
    throw new Error(errText)
  }
  if (!data?.success) {
    throw new Error(String(data?.error || '接口返回失败'))
  }
  return data
}

async function main() {
  loadEnv()
  const args = process.argv.slice(2)
  const pollMs = Math.max(toInt(pickArgValue(args, '--poll-ms'), 1000), 300)
  const timeoutMs = Math.max(toInt(pickArgValue(args, '--timeout-ms'), 20 * 60 * 1000), 10 * 1000)
  const origin = normalizeOrigin(
    pickArgValue(args, '--origin')
    || process.env.RECOVER_TRIGGER_ORIGIN
    || process.env.APP_PUBLIC_ORIGIN
    || 'http://127.0.0.1:3000'
  )
  const token = pickArgValue(args, '--token') || String(process.env.ADMIN_SETTINGS_TOKEN || '').trim()
  const triggerUrl = `${origin}/api/admin/recover-upload/trigger`
  const jobsUrl = `${origin}/api/admin/recover-upload/jobs`

  console.log('开始触发 pending 恢复上传...\n')
  const trigger = await postJson(triggerUrl, {}, token)
  const requeuedJobIds = Array.isArray(trigger.requeuedJobIds)
    ? [...new Set(trigger.requeuedJobIds.map(v => String(v || '').trim()).filter(Boolean))]
    : []

  console.log('触发结果:')
  console.log(`  total: ${Number(trigger.total || 0)}`)
  console.log(`  requeued: ${Number(trigger.requeued || 0)}`)
  console.log(`  skippedAlreadyQueued: ${Number(trigger.skippedAlreadyQueued || 0)}`)
  console.log(`  skippedMissingFile: ${Number(trigger.skippedMissingFile || 0)}`)
  console.log(`  removedInvalid: ${Number(trigger.removedInvalid || 0)}`)
  console.log(`  queueLength: ${Number(trigger.queueLength || 0)}`)
  console.log(`  running: ${trigger.running === true ? 'yes' : 'no'}`)

  if (requeuedJobIds.length === 0) {
    console.log('\n本次没有新的恢复任务需要跟踪。')
    return
  }

  console.log(`\n开始跟踪 ${requeuedJobIds.length} 个任务日志（poll=${pollMs}ms, timeout=${timeoutMs}ms）...\n`)

  const start = Date.now()
  const lastState = new Map()
  let timeoutReached = false
  let latestJobs = []

  while (true) {
    const jobsPayload = await postJson(jobsUrl, { jobIds: requeuedJobIds }, token)
    latestJobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : []

    for (const job of latestJobs) {
      const id = String(job.id || '').trim()
      if (!id) continue
      const prev = lastState.get(id)
      const changed = !prev
        || prev.status !== job.status
        || Number(prev.attempt || 0) !== Number(job.attempt || 0)
        || String(prev.error || '') !== String(job.error || '')
      if (changed) {
        printJobUpdate(job)
        lastState.set(id, {
          status: String(job.status || ''),
          attempt: Number(job.attempt || 0),
          error: String(job.error || '')
        })
      }
    }

    const doneCount = latestJobs.filter(j => FINAL_STATUS.has(String(j.status || ''))).length
    if (doneCount >= requeuedJobIds.length) break

    if ((Date.now() - start) >= timeoutMs) {
      timeoutReached = true
      break
    }
    await sleep(pollMs)
  }

  summarizeFinal(latestJobs, timeoutReached)
  const hasFailed = latestJobs.some(j => j.status === 'failed' || j.status === 'missing')
  const hasUnfinished = latestJobs.some(j => !FINAL_STATUS.has(String(j.status || '')))
  if (hasFailed || hasUnfinished) process.exit(1)
}

main().catch(err => {
  const text = String(err?.message || err)
  console.error(`recover:auto 执行失败: ${text}`)
  if (text.toLowerCase().includes('fetch failed')) {
    console.error('请确认服务已启动，并检查 --origin 是否正确。')
  }
  process.exit(1)
})
