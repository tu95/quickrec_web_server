#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const ROOT_DIR = path.resolve(process.cwd())
const ENV_LOCAL_PATH = path.join(ROOT_DIR, '.env.local')
const README_PATH = path.join(ROOT_DIR, 'README.md')
const START_MARKER = '<!-- TEST_USER_CREDENTIALS_START -->'
const END_MARKER = '<!-- TEST_USER_CREDENTIALS_END -->'

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

function makeRandomPassword() {
  const base = crypto.randomBytes(16).toString('base64url')
  return `${base}A!9`
}

function readExistingPasswordFromReadme() {
  if (!fs.existsSync(README_PATH)) return ''
  const text = fs.readFileSync(README_PATH, 'utf8')
  const markerStart = text.indexOf(START_MARKER)
  const markerEnd = text.indexOf(END_MARKER)
  if (markerStart < 0 || markerEnd < 0 || markerEnd <= markerStart) return ''
  const block = text.slice(markerStart, markerEnd)
  const match = block.match(/- 密码:\s*`([^`]+)`/)
  return match ? String(match[1] || '').trim() : ''
}

function renderReadmeBlock(email, password) {
  return [
    START_MARKER,
    '## 普通用户测试账号（自动维护）',
    '',
    '- 邮箱: `test@test.com`',
    `- 密码: \`${password}\``,
    '- 权限: 普通用户（非管理员）',
    '- 用途: 每次联调/回归时使用该账号从普通用户视角测试',
    '',
    `> 如需重置：在 \`web_server\` 目录执行 \`npm run ensure:test-user\`。`,
    END_MARKER
  ].join('\n')
}

function upsertReadmeBlock(email, password) {
  const block = renderReadmeBlock(email, password)
  const current = fs.existsSync(README_PATH) ? fs.readFileSync(README_PATH, 'utf8') : ''
  const start = current.indexOf(START_MARKER)
  const end = current.indexOf(END_MARKER)
  if (start >= 0 && end > start) {
    const next = `${current.slice(0, start).trimEnd()}\n\n${block}\n${current.slice(end + END_MARKER.length).replace(/^\s*\n/, '')}`
    fs.writeFileSync(README_PATH, next, 'utf8')
    return
  }
  const next = `${current.trimEnd()}\n\n${block}\n`
  fs.writeFileSync(README_PATH, next, 'utf8')
}

async function findUserByEmail(admin, email) {
  const target = String(email || '').trim().toLowerCase()
  let page = 1
  const perPage = 200
  while (page <= 20) {
    const { data, error } = await admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers 失败: ${String(error.message || error)}`)
    const users = Array.isArray(data?.users) ? data.users : []
    const hit = users.find(item => String(item?.email || '').trim().toLowerCase() === target)
    if (hit) return hit
    if (users.length < perPage) break
    page += 1
  }
  return null
}

async function ensureTestUser() {
  const parsedEnv = parseEnvFile(ENV_LOCAL_PATH)
  const supabaseUrl = pickEnv('SUPABASE_URL', parsedEnv)
  const serviceRoleKey = pickEnv('SUPABASE_SERVICE_ROLE_KEY', parsedEnv)
  const email = pickEnv('TEST_USER_EMAIL', parsedEnv) || 'test@test.com'

  if (!supabaseUrl) {
    throw new Error('缺少 SUPABASE_URL（请在 .env.local 配置）')
  }
  if (!serviceRoleKey) {
    throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY（请在 .env.local 配置）')
  }

  const existingReadmePassword = readExistingPasswordFromReadme()
  const finalPassword = existingReadmePassword || makeRandomPassword()

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const admin = client.auth.admin
  let user = await findUserByEmail(admin, email)
  if (!user) {
    const { data, error } = await admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true,
      user_metadata: {
        display_name: 'Test User'
      }
    })
    if (error) throw new Error(`createUser 失败: ${String(error.message || error)}`)
    user = data?.user || null
  } else {
    const { error } = await admin.updateUserById(String(user.id), {
      password: finalPassword,
      email_confirm: true
    })
    if (error) throw new Error(`updateUserById 失败: ${String(error.message || error)}`)
  }

  upsertReadmeBlock(email, finalPassword)

  return {
    email,
    password: finalPassword,
    userId: String(user?.id || '')
  }
}

ensureTestUser()
  .then(result => {
    console.log('[ensure-test-user] ok')
    console.log(`email=${result.email}`)
    console.log(`password=${result.password}`)
    console.log(`userId=${result.userId}`)
  })
  .catch(error => {
    console.error('[ensure-test-user] failed:', String(error?.message || error))
    process.exitCode = 1
  })
