import { randomInt } from 'node:crypto'
import { createSupabaseServiceClient } from './supabase-client'
import { generateSessionToken } from './user-auth'
import { getSecurityConfig } from './security-config'

const TABLE = {
  devices: 'recorder_devices',
  pairCodes: 'recorder_pair_codes',
  userDevices: 'recorder_user_devices',
  deviceSessions: 'recorder_device_sessions',
  recordings: 'recorder_recordings'
}

function nowIso() {
  return new Date().toISOString()
}

function addSeconds(baseIso, deltaSec) {
  const ts = new Date(baseIso).getTime() + Number(deltaSec || 0) * 1000
  return new Date(ts).toISOString()
}

function normalizeDeviceIdentity(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  return text.slice(0, 120)
}

function normalizePairCode(raw) {
  return String(raw || '').trim().toUpperCase()
}

function buildPairCode(length) {
  const parsed = Number(length)
  const size = Number.isFinite(parsed) ? Math.max(1, Math.min(12, Math.floor(parsed))) : 6
  const max = Math.pow(10, size)
  const n = randomInt(0, max)
  return String(n).padStart(size, '0')
}

function normalizeStatus(text, fallback) {
  const status = String(text || '').trim().toLowerCase()
  if (!status) return String(fallback || '')
  return status
}

function isExpired(isoText) {
  const ts = new Date(String(isoText || '')).getTime()
  if (!Number.isFinite(ts) || ts <= 0) return true
  return Date.now() >= ts
}

function firstRow(data) {
  if (Array.isArray(data) && data.length > 0) return data[0]
  return null
}

function normalizeText(raw, maxLen = 0) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (!maxLen || maxLen <= 0) return text
  return text.slice(0, maxLen)
}

function isUuidText(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function getDbErrorText(error) {
  if (!error || typeof error !== 'object') return ''
  return [
    String(error.code || ''),
    String(error.message || ''),
    String(error.details || ''),
    String(error.hint || '')
  ].join(' ').toLowerCase()
}

function isUniqueViolationError(error) {
  const code = String(error?.code || '').trim()
  if (code === '23505') return true
  const text = getDbErrorText(error)
  return text.includes('duplicate') || text.includes('unique')
}

async function getLatestPendingPairCode(client, deviceId, nowIsoText) {
  const now = String(nowIsoText || nowIso())
  const { data, error } = await client
    .from(TABLE.pairCodes)
    .select('*')
    .eq('device_id', deviceId)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(String(error.message || '读取配对码失败'))
  return firstRow(data)
}

async function getDeviceByIdentity(identity) {
  const deviceIdentity = normalizeDeviceIdentity(identity)
  if (!deviceIdentity) return null
  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(TABLE.devices)
    .select('*')
    .eq('device_identity', deviceIdentity)
    .limit(1)
  if (error) throw new Error(String(error.message || '读取设备失败'))
  return firstRow(data)
}

export async function ensureDevice(identity, identitySource, deviceSource) {
  const deviceIdentity = normalizeDeviceIdentity(identity)
  if (!deviceIdentity) throw new Error('设备标识不能为空')
  const client = createSupabaseServiceClient()
  const now = nowIso()
  const source = String(identitySource || '').trim()
  const sourceTag = String(deviceSource || '').trim()
  const payload = {
    device_identity: deviceIdentity,
    last_seen_at: now,
    updated_at: now
  }
  if (source) {
    payload.identity_source = source
  }
  if (sourceTag) {
    payload.device_source = sourceTag
  }
  const { data, error } = await client
    .from(TABLE.devices)
    .upsert(payload, { onConflict: 'device_identity' })
    .select('*')
    .limit(1)
  if (error) throw new Error(String(error.message || '写入设备失败'))
  const row = firstRow(data)
  if (!row) throw new Error('写入设备失败：空结果')
  return row
}

export async function touchDeviceMetadata(identity, identitySource, deviceSource) {
  const deviceIdentity = normalizeDeviceIdentity(identity)
  if (!deviceIdentity) return null
  const source = String(identitySource || '').trim()
  const sourceTag = String(deviceSource || '').trim()
  if (!source && !sourceTag) {
    return getDeviceByIdentity(deviceIdentity)
  }

  const client = createSupabaseServiceClient()
  const now = nowIso()
  const patch = {
    last_seen_at: now,
    updated_at: now
  }
  if (source) {
    patch.identity_source = source
  }
  if (sourceTag) {
    patch.device_source = sourceTag
  }
  const { data, error } = await client
    .from(TABLE.devices)
    .update(patch)
    .eq('device_identity', deviceIdentity)
    .select('*')
    .limit(1)
  if (error) throw new Error(String(error.message || '更新设备信息失败'))
  const row = firstRow(data)
  if (row) return row
  return ensureDevice(deviceIdentity, source, sourceTag)
}

export async function createPairCodeForDevice(deviceIdentity, identitySource, deviceSource, options) {
  // 这个函数主要是为设备发配对码，并在已绑定时直接回传可用会话。
  const opts = options && typeof options === 'object' ? options : {}
  const forceRebind = opts.forceRebind === true
  const security = getSecurityConfig()
  const device = await ensureDevice(deviceIdentity, identitySource, deviceSource)
  const client = createSupabaseServiceClient()
  const now = nowIso()

  await client
    .from(TABLE.pairCodes)
    .update({ status: 'expired', updated_at: now })
    .eq('device_id', device.id)
    .eq('status', 'pending')
    .lt('expires_at', now)

  if (!forceRebind) {
    const activeSession = await getActiveDeviceSessionByDevice(device.id)
    if (activeSession) {
      return {
        device,
        alreadyPaired: true,
        status: 'already_paired',
        pairCode: '',
        expiresAt: '',
        sessionToken: String(activeSession.session_token || ''),
        sessionExpiresAt: String(activeSession.expires_at || '')
      }
    }
  } else {
    await revokeActiveDeviceSessions(device.id)
  }

  if (!forceRebind) {
    const pending = await getLatestPendingPairCode(client, device.id, now)
    if (pending) {
      return {
        device,
        alreadyPaired: false,
        status: 'pending_reused',
        pairCode: String(pending.pair_code || ''),
        expiresAt: String(pending.expires_at || '')
      }
    }
  } else {
    // 强制重绑时，作废当前设备未过期的 pending 码，保证后续下发的是新链路。
    await client
      .from(TABLE.pairCodes)
      .update({ status: 'replaced', updated_at: now })
      .eq('device_id', device.id)
      .eq('status', 'pending')
      .gt('expires_at', now)
  }

  let created = null
  for (let i = 0; i < 8; i += 1) {
    const pairCode = buildPairCode(security.pair.codeLength)
    const insertNow = nowIso()
    const expiresAt = addSeconds(insertNow, security.pair.codeTtlSec)
    const { data, error } = await client
      .from(TABLE.pairCodes)
      .insert({
        device_id: device.id,
        pair_code: pairCode,
        status: 'pending',
        expires_at: expiresAt,
        created_at: insertNow,
        updated_at: insertNow
      })
      .select('*')
      .limit(1)
    if (!error) {
      created = firstRow(data)
      break
    }
    if (isUniqueViolationError(error)) {
      // 并发下可能是：pair_code 冲突，或同设备 pending 约束命中；优先复用最新 pending。
      const pending = await getLatestPendingPairCode(client, device.id, nowIso())
      if (pending) {
        return {
          device,
          alreadyPaired: false,
          status: 'pending_reused',
          pairCode: String(pending.pair_code || ''),
          expiresAt: String(pending.expires_at || '')
        }
      }
      continue
    }
    throw new Error(String(error.message || '创建配对码失败'))
  }
  if (!created) {
    // 最后一次兜底：若并发已成功写入 pending，直接复用。
    const pending = await getLatestPendingPairCode(client, device.id, nowIso())
    if (pending) {
      return {
        device,
        alreadyPaired: false,
        status: 'pending_reused',
        pairCode: String(pending.pair_code || ''),
        expiresAt: String(pending.expires_at || '')
      }
    }
    throw new Error('创建配对码失败：重试次数超限')
  }
  return {
    device,
    alreadyPaired: false,
    status: 'pending_created',
    pairCode: String(created.pair_code || ''),
    expiresAt: String(created.expires_at || '')
  }
}

export async function readPairCodeStatus(deviceIdentity, pairCode) {
  const device = await getDeviceByIdentity(deviceIdentity)
  if (!device) {
    return {
      found: false,
      status: 'missing',
      paired: false
    }
  }
  const code = normalizePairCode(pairCode)
  if (!code) {
    return {
      found: false,
      status: 'missing',
      paired: false,
      device
    }
  }
  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(TABLE.pairCodes)
    .select('*')
    .eq('pair_code', code)
    .eq('device_id', device.id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(String(error.message || '读取配对状态失败'))
  const row = firstRow(data)
  if (!row) {
    return {
      found: false,
      status: 'missing',
      paired: false,
      device
    }
  }

  let status = normalizeStatus(row.status, 'pending')
  const expired = isExpired(row.expires_at)
  if (status === 'pending' && expired) {
    status = 'expired'
    await client
      .from(TABLE.pairCodes)
      .update({ status: 'expired', updated_at: nowIso() })
      .eq('id', row.id)
  }
  return {
    found: true,
    status,
    paired: status === 'used',
    row,
    device
  }
}

async function getActiveDeviceSession(deviceId, userId) {
  const client = createSupabaseServiceClient()
  const now = nowIso()
  const { data, error } = await client
    .from(TABLE.deviceSessions)
    .select('*')
    .eq('device_id', deviceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(String(error.message || '读取设备会话失败'))
  return firstRow(data)
}

async function getActiveDeviceSessionByDevice(deviceId) {
  const client = createSupabaseServiceClient()
  const now = nowIso()
  const { data, error } = await client
    .from(TABLE.deviceSessions)
    .select('*')
    .eq('device_id', deviceId)
    .eq('status', 'active')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(String(error.message || '读取设备会话失败'))
  return firstRow(data)
}

async function revokeActiveDeviceSessions(deviceId) {
  const client = createSupabaseServiceClient()
  const now = nowIso()
  const { error } = await client
    .from(TABLE.deviceSessions)
    .update({
      status: 'revoked',
      updated_at: now
    })
    .eq('device_id', deviceId)
    .eq('status', 'active')
  if (error) throw new Error(String(error.message || '撤销设备会话失败'))
}

async function createDeviceSession(deviceId, userId) {
  const security = getSecurityConfig()
  const client = createSupabaseServiceClient()
  const now = nowIso()
  const expiresAt = addSeconds(now, security.pair.deviceSessionTtlSec)
  const token = generateSessionToken()
  const { data, error } = await client
    .from(TABLE.deviceSessions)
    .insert({
      device_id: deviceId,
      user_id: userId,
      session_token: token,
      status: 'active',
      expires_at: expiresAt,
      created_at: now,
      updated_at: now,
      last_seen_at: now
    })
    .select('*')
    .limit(1)
  if (error) throw new Error(String(error.message || '创建设备会话失败'))
  const row = firstRow(data)
  if (!row) throw new Error('创建设备会话失败：空结果')
  return row
}

async function getOrCreateDeviceSession(deviceId, userId) {
  const active = await getActiveDeviceSession(deviceId, userId)
  if (active) return active
  return createDeviceSession(deviceId, userId)
}

export async function bindUserByPairCode(userId, pairCode) {
  const uid = String(userId || '').trim()
  const code = normalizePairCode(pairCode)
  if (!uid) throw new Error('用户信息为空')
  if (!code) throw new Error('配对码不能为空')

  const client = createSupabaseServiceClient()
  const now = nowIso()
  const { data, error } = await client
    .from(TABLE.pairCodes)
    .select('*')
    .eq('pair_code', code)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(String(error.message || '读取配对码失败'))
  const pairRow = firstRow(data)
  if (!pairRow) throw new Error('配对码不存在')

  const status = normalizeStatus(pairRow.status, 'pending')
  if (status !== 'pending') {
    if (status === 'used') throw new Error('配对码已被使用')
    if (status === 'expired') throw new Error('配对码已过期')
    throw new Error('配对码不可用')
  }
  if (isExpired(pairRow.expires_at)) {
    await client
      .from(TABLE.pairCodes)
      .update({ status: 'expired', updated_at: now })
      .eq('id', pairRow.id)
    throw new Error('配对码已过期')
  }

  const { data: deviceRows, error: deviceError } = await client
    .from(TABLE.devices)
    .select('*')
    .eq('id', pairRow.device_id)
    .limit(1)
  if (deviceError) throw new Error(String(deviceError.message || '读取设备失败'))
  const device = firstRow(deviceRows)
  if (!device) throw new Error('设备不存在')

  const { data: pairClaimRows, error: pairUpdateError } = await client
    .from(TABLE.pairCodes)
    .update({
      status: 'used',
      used_at: now,
      used_by_user_id: uid,
      updated_at: now
    })
    .eq('id', pairRow.id)
    .eq('status', 'pending')
    .select('id')
    .limit(1)
  if (pairUpdateError) throw new Error(String(pairUpdateError.message || '更新配对码失败'))
  if (!firstRow(pairClaimRows)) throw new Error('配对码已被使用，请刷新后重试')

  const { error: deactivateError } = await client
    .from(TABLE.userDevices)
    .update({
      status: 'inactive',
      updated_at: now
    })
    .eq('device_id', device.id)
    .neq('user_id', uid)
    .eq('status', 'active')
  if (deactivateError) throw new Error(String(deactivateError.message || '更新历史绑定失败'))

  const upsertPayload = {
    user_id: uid,
    device_id: device.id,
    status: 'active',
    bound_at: now,
    updated_at: now
  }
  const { error: bindError } = await client
    .from(TABLE.userDevices)
    .upsert(upsertPayload, { onConflict: 'user_id,device_id' })
  if (bindError) throw new Error(String(bindError.message || '绑定设备失败'))

  const session = await getOrCreateDeviceSession(device.id, uid)
  return {
    device,
    sessionToken: String(session.session_token || ''),
    sessionExpiresAt: String(session.expires_at || '')
  }
}

export async function issueDeviceSessionByPairCode(deviceIdentity, pairCode) {
  const status = await readPairCodeStatus(deviceIdentity, pairCode)
  if (!status.found || !status.row || !status.device) {
    return {
      paired: false,
      status: status.status || 'missing'
    }
  }
  if (status.status !== 'used') {
    return {
      paired: false,
      status: status.status
    }
  }

  const userId = String(status.row.used_by_user_id || '').trim()
  if (!userId) {
    return {
      paired: false,
      status: 'used'
    }
  }
  const session = await getOrCreateDeviceSession(status.device.id, userId)
  return {
    paired: true,
    status: 'used',
    device: status.device,
    sessionToken: String(session.session_token || ''),
    sessionExpiresAt: String(session.expires_at || '')
  }
}

export async function getDeviceSessionStatus(sessionTokenOrDeviceIdentity, maybeSessionToken) {
  const token = String(maybeSessionToken || sessionTokenOrDeviceIdentity || '').trim()
  if (!token) throw new Error('设备会话 token 不能为空')

  const client = createSupabaseServiceClient()
  const { data: sessionRows, error: sessionError } = await client
    .from(TABLE.deviceSessions)
    .select('*')
    .eq('session_token', token)
    .order('created_at', { ascending: false })
    .limit(1)
  if (sessionError) throw new Error(String(sessionError.message || '读取设备会话失败'))
  const session = firstRow(sessionRows)
  if (!session) {
    return {
      active: false,
      status: 'session_invalid'
    }
  }

  const deviceId = String(session.device_id || '').trim()
  const { data: deviceRows, error: deviceError } = await client
    .from(TABLE.devices)
    .select('*')
    .eq('id', deviceId)
    .limit(1)
  if (deviceError) throw new Error(String(deviceError.message || '读取设备失败'))
  const device = firstRow(deviceRows)
  if (!device) {
    return {
      active: false,
      status: 'device_missing',
      sessionExpiresAt: String(session.expires_at || '')
    }
  }

  const status = normalizeStatus(session.status, '')
  if (status !== 'active') {
    return {
      active: false,
      status: status === 'revoked' ? 'unbound' : ('session_' + (status || 'inactive')),
      device,
      sessionExpiresAt: String(session.expires_at || '')
    }
  }

  if (isExpired(session.expires_at)) {
    await client
      .from(TABLE.deviceSessions)
      .update({ status: 'expired', updated_at: nowIso() })
      .eq('id', session.id)
      .eq('status', 'active')
    return {
      active: false,
      status: 'session_expired',
      device,
      sessionExpiresAt: String(session.expires_at || '')
    }
  }

  const sessionUserId = String(session.user_id || '').trim()
  if (!sessionUserId) {
    return {
      active: false,
      status: 'session_invalid',
      device,
      sessionExpiresAt: String(session.expires_at || '')
    }
  }

  const { data: bindRows, error: bindError } = await client
    .from(TABLE.userDevices)
    .select('id')
    .eq('device_id', device.id)
    .eq('user_id', sessionUserId)
    .eq('status', 'active')
    .limit(1)
  if (bindError) throw new Error(String(bindError.message || '读取设备绑定关系失败'))
  if (!firstRow(bindRows)) {
    return {
      active: false,
      status: 'unbound',
      device,
      sessionExpiresAt: String(session.expires_at || '')
    }
  }

  const now = nowIso()
  await client
    .from(TABLE.deviceSessions)
    .update({ last_seen_at: now, updated_at: now })
    .eq('id', session.id)

  return {
    active: true,
    status: 'active',
    device,
    userId: sessionUserId,
    sessionExpiresAt: String(session.expires_at || '')
  }
}

export async function validateDeviceSessionForUpload(sessionTokenOrDeviceIdentity, maybeSessionToken) {
  const token = String(maybeSessionToken || sessionTokenOrDeviceIdentity || '').trim()
  if (!token) throw new Error('设备会话 token 不能为空')

  const client = createSupabaseServiceClient()
  const now = nowIso()
  const { data: sessionRows, error: sessionError } = await client
    .from(TABLE.deviceSessions)
    .select('*')
    .eq('session_token', token)
    .eq('status', 'active')
    .gt('expires_at', now)
    .limit(1)
  if (sessionError) throw new Error(String(sessionError.message || '读取设备会话失败'))
  const session = firstRow(sessionRows)
  if (!session) throw new Error('设备会话已失效，请重新配对')

  const deviceId = String(session.device_id || '').trim()
  const { data: deviceRows, error: deviceError } = await client
    .from(TABLE.devices)
    .select('*')
    .eq('id', deviceId)
    .limit(1)
  if (deviceError) throw new Error(String(deviceError.message || '读取设备失败'))
  const device = firstRow(deviceRows)
  if (!device) throw new Error('设备未绑定，请先配对')

  const sessionUserId = String(session.user_id || '').trim()
  if (!sessionUserId) throw new Error('设备会话已失效，请重新配对')

  const { data: bindRows, error: bindError } = await client
    .from(TABLE.userDevices)
    .select('id')
    .eq('device_id', device.id)
    .eq('user_id', sessionUserId)
    .eq('status', 'active')
    .limit(1)
  if (bindError) throw new Error(String(bindError.message || '读取设备绑定关系失败'))
  if (!firstRow(bindRows)) throw new Error('设备未绑定，请先配对')

  await client
    .from(TABLE.deviceSessions)
    .update({ last_seen_at: now, updated_at: now })
    .eq('id', session.id)

  return {
    device,
    userId: sessionUserId
  }
}

export async function insertRecordingMetadata(input) {
  const payload = input && typeof input === 'object' ? input : {}
  const client = createSupabaseServiceClient()
  const now = nowIso()
  const row = {
    user_id: String(payload.userId || '').trim(),
    device_id: String(payload.deviceId || '').trim(),
    file_name: String(payload.fileName || '').trim(),
    oss_key: String(payload.ossKey || '').trim(),
    oss_url: String(payload.ossUrl || '').trim(),
    oss_bucket: String(payload.ossBucket || '').trim(),
    size_bytes: Number(payload.sizeBytes) || 0,
    duration_sec: Number(payload.durationSec) || 0,
    sha256: String(payload.sha256 || '').trim(),
    status: String(payload.status || 'uploaded'),
    created_at: now,
    uploaded_at: now,
    updated_at: now
  }
  const { data, error } = await client
    .from(TABLE.recordings)
    .insert(row)
    .select('*')
    .limit(1)
  if (error) throw new Error(String(error.message || '写入录音记录失败'))
  return firstRow(data)
}

export async function listUserRecordings(userId, options) {
  const uid = normalizeText(userId, 120)
  if (!uid) return []
  const opts = (options && typeof options === 'object') ? options : {}
  const limit = Number(opts.limit)
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(500, Math.floor(limit)))
    : 300

  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(TABLE.recordings)
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(safeLimit)
  if (error) throw new Error(String(error.message || '读取录音列表失败'))
  return Array.isArray(data) ? data : []
}

export async function getUserRecordingById(userId, recordingId) {
  const uid = normalizeText(userId, 120)
  const rid = normalizeText(recordingId, 120)
  if (!uid || !rid || !isUuidText(rid)) return null
  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(TABLE.recordings)
    .select('*')
    .eq('id', rid)
    .eq('user_id', uid)
    .limit(1)
  if (error) throw new Error(String(error.message || '读取录音失败'))
  return firstRow(data)
}

export async function findLatestUserRecordingByFileName(userId, fileName) {
  const uid = normalizeText(userId, 120)
  const name = normalizeText(fileName, 255)
  if (!uid || !name) return null
  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(TABLE.recordings)
    .select('*')
    .eq('user_id', uid)
    .eq('file_name', name)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(String(error.message || '读取录音失败'))
  return firstRow(data)
}

export async function deleteUserRecordingById(userId, recordingId) {
  const uid = normalizeText(userId, 120)
  const rid = normalizeText(recordingId, 120)
  if (!uid || !rid || !isUuidText(rid)) throw new Error('录音参数无效')
  const client = createSupabaseServiceClient()

  const existing = await getUserRecordingById(uid, rid)
  if (!existing) {
    return {
      deleted: false,
      existed: false,
      recording: null
    }
  }

  const { data, error } = await client
    .from(TABLE.recordings)
    .delete()
    .eq('id', rid)
    .eq('user_id', uid)
    .select('*')
    .limit(1)
  if (error) throw new Error(String(error.message || '删除录音失败'))
  const deletedRow = firstRow(data)
  return {
    deleted: !!deletedRow,
    existed: true,
    recording: deletedRow || existing
  }
}

export async function listUserDevices(userId) {
  const uid = String(userId || '').trim()
  if (!uid) return []
  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(TABLE.userDevices)
    .select(`
      id,
      status,
      bound_at,
      device:recorder_devices (
        id,
        device_identity,
        identity_source,
        device_source,
        updated_at
      )
    `)
    .eq('user_id', uid)
    .eq('status', 'active')
    .order('bound_at', { ascending: false })
  if (error) throw new Error(String(error.message || '读取设备列表失败'))
  return Array.isArray(data) ? data : []
}

export async function unbindUserDevice(userId, deviceId) {
  const uid = String(userId || '').trim()
  const did = String(deviceId || '').trim()
  if (!uid) throw new Error('用户信息为空')
  if (!did) throw new Error('设备信息为空')

  const client = createSupabaseServiceClient()
  const now = nowIso()
  const { data: rows, error: lookupError } = await client
    .from(TABLE.userDevices)
    .select(`
      id,
      status,
      device_id,
      device:recorder_devices (
        id,
        device_identity,
        identity_source,
        device_source
      )
    `)
    .eq('user_id', uid)
    .eq('device_id', did)
    .order('updated_at', { ascending: false })
    .limit(1)
  if (lookupError) throw new Error(String(lookupError.message || '读取绑定关系失败'))
  const row = firstRow(rows)
  if (!row) throw new Error('设备未绑定到当前账号')

  const relationStatus = String(row.status || '').trim().toLowerCase()
  if (relationStatus === 'active') {
    const { error: unbindError } = await client
      .from(TABLE.userDevices)
      .update({
        status: 'inactive',
        updated_at: now
      })
      .eq('user_id', uid)
      .eq('device_id', did)
      .eq('status', 'active')
    if (unbindError) throw new Error(String(unbindError.message || '解除设备绑定失败'))

    const { error: revokeError } = await client
      .from(TABLE.deviceSessions)
      .update({
        status: 'revoked',
        updated_at: now
      })
      .eq('user_id', uid)
      .eq('device_id', did)
      .eq('status', 'active')
    if (revokeError) throw new Error(String(revokeError.message || '吊销设备会话失败'))
  }

  return {
    alreadyUnbound: relationStatus !== 'active',
    device: row.device || null
  }
}
