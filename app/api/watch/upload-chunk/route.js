import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { enqueueMp3Convert } from '../../_lib/mp3-queue'
import { probeAudioDurationSec } from '../../_lib/audio-duration'
import { readConfigForUser } from '../../_lib/config-store'
import { uploadBufferToOss } from '../../_lib/oss-storage'
import {
  insertRecordingMetadata,
  validateDeviceSessionForUpload
} from '../../_lib/recorder-multiuser-store'
import { getSupabaseConfigError } from '../../_lib/supabase-client'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const TMP_DIR = join(process.cwd(), 'uploads_tmp')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-Session-Token',
}

const MAX_UPLOAD_BYTES = 120 * 1024 * 1024
const MAX_BATCH_UPLOAD_BYTES = (() => {
  const value = Number(process.env.WATCH_UPLOAD_BATCH_MAX_BYTES || 1024 * 1024)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1024 * 1024
})()
const MAX_BATCH_CHUNKS = (() => {
  const value = Number(process.env.WATCH_UPLOAD_BATCH_MAX_CHUNKS || 16)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 16
})()
const UPLOAD_SESSION_STALE_MS = 25 * 60 * 1000
const ASYNC_UPLOAD_MAX_RETRIES = 3
const ASYNC_UPLOAD_RETRY_DELAY_MS = 1200
const MAX_RECENT_ASYNC_JOBS = 120

const uploadSessionMap = new Map()
const asyncUploadQueue = []
const asyncUploadJobMap = new Map()
const recentAsyncUploadJobs = []

let asyncUploadRunning = false

function withCorsHeaders(extra) {
  return Object.assign({}, CORS_HEADERS, extra || {})
}

async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  await fs.mkdir(TMP_DIR, { recursive: true })
}

function nowMs() {
  return Date.now()
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Number(ms) || 0))
}

function safeFileName(name) {
  const value = String(name || '')
  const base = basename(value).replace(/[\\/]/g, '_').trim()
  return base || `recording_${Date.now()}.opus`
}

function normalizeUserObjectTag(userId) {
  const raw = String(userId || '').trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (!raw) return 'u_unknown'
  return `u_${raw.slice(0, 16)}`
}

function buildObjectFileName(fileName, userId) {
  const safe = safeFileName(fileName)
  const userTag = normalizeUserObjectTag(userId)
  return `${userTag}_${Date.now()}_${Math.floor(Math.random() * 1000000)}_${safe}`
}

function buildUploadSessionKey(userId, uploadId) {
  const uid = String(userId || '').trim()
  const upid = String(uploadId || '').trim()
  return `${uid}:${upid}`
}

function toPartFileNameFromSessionKey(sessionKey) {
  const safe = String(sessionKey || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safe}.part`
}

async function buildUniqueFileName(originalName) {
  const safeName = safeFileName(originalName)
  let filename = safeName
  let counter = 1
  while (true) {
    try {
      await fs.access(join(UPLOAD_DIR, filename))
      const ext = extname(safeName)
      const base = ext ? safeName.slice(0, -ext.length) : safeName
      filename = `${base}_${counter}${ext}`
      counter += 1
    } catch {
      return filename
    }
  }
}

function normalizeDeviceIdentity(body) {
  if (!body || typeof body !== 'object') return ''
  return String(body.deviceId || body.deviceIdentity || body.watchUuid || '').trim()
}

function normalizeSessionToken(request, body) {
  const fromHeader = String(request.headers.get('x-device-session-token') || '').trim()
  if (fromHeader) return fromHeader
  return String(body?.sessionToken || '').trim()
}

function normalizeBase64(data) {
  const raw = String(data || '')
  if (!raw) return ''
  const maybePayload = raw.startsWith('data:') && raw.includes(',')
    ? raw.slice(raw.indexOf(',') + 1)
    : raw
  const cleaned = maybePayload
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '')
  if (!cleaned) return ''
  const remain = cleaned.length % 4
  return remain === 0 ? cleaned : cleaned + '='.repeat(4 - remain)
}

function decodeBase64Chunk(data) {
  const text = normalizeBase64(data)
  if (!text) throw new Error('chunk 数据为空')
  const buffer = Buffer.from(text, 'base64')
  if (!buffer.length) throw new Error('chunk 数据无效')
  return buffer
}

function parseRequestBody(body) {
  const uploadId = String(body?.uploadId || '').trim()
  const fileName = safeFileName(body?.fileName)
  const total = Number(body?.total)
  const size = Number(body?.size) || 0

  if (!uploadId) throw new Error('uploadId 不能为空')
  if (!Number.isInteger(total) || total <= 0) throw new Error('total 无效')
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(`文件过大，最大 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`)
  }

  const chunkList = []
  const chunksBody = Array.isArray(body?.chunks) ? body.chunks : null
  if (chunksBody && chunksBody.length > 0) {
    if (chunksBody.length > MAX_BATCH_CHUNKS) {
      throw new Error(`单次批量分片过多，最大 ${MAX_BATCH_CHUNKS}`)
    }
    let batchBytes = 0
    for (let i = 0; i < chunksBody.length; i += 1) {
      const item = chunksBody[i] || {}
      const index = Number(item?.index)
      if (!Number.isInteger(index) || index < 0) throw new Error('chunks.index 无效')
      if (index >= total) throw new Error('chunks.index 越界')
      const buffer = decodeBase64Chunk(item?.data)
      batchBytes += buffer.length
      if (batchBytes > MAX_BATCH_UPLOAD_BYTES) {
        throw new Error(`单次批量数据过大，最大 ${Math.floor(MAX_BATCH_UPLOAD_BYTES / 1024)}KB`)
      }
      chunkList.push({ index, buffer })
    }
  } else {
    const index = Number(body?.index)
    if (!Number.isInteger(index) || index < 0) throw new Error('index 无效')
    if (index >= total) throw new Error('index 越界')
    const buffer = decodeBase64Chunk(body?.data)
    chunkList.push({ index, buffer })
  }
  chunkList.sort((a, b) => a.index - b.index)
  for (let i = 1; i < chunkList.length; i += 1) {
    if (chunkList[i].index !== chunkList[i - 1].index + 1) {
      throw new Error('chunks.index 必须连续递增')
    }
  }
  const firstIndex = Number(chunkList[0]?.index || 0)
  const lastIndex = Number(chunkList[chunkList.length - 1]?.index || firstIndex)

  return {
    uploadId,
    fileName,
    total,
    size,
    chunks: chunkList,
    firstIndex,
    lastIndex
  }
}

function pushRecentAsyncJob(job) {
  recentAsyncUploadJobs.push(job)
  if (recentAsyncUploadJobs.length > MAX_RECENT_ASYNC_JOBS) {
    recentAsyncUploadJobs.splice(0, recentAsyncUploadJobs.length - MAX_RECENT_ASYNC_JOBS)
  }
}

function snapshotAsyncJob(job) {
  return {
    id: String(job.id || ''),
    uploadId: String(job.uploadId || ''),
    status: String(job.status || ''),
    attempt: Number(job.attempt || 0),
    maxRetries: Number(job.maxRetries || 0),
    queuedAt: Number(job.queuedAt || 0),
    startedAt: Number(job.startedAt || 0),
    finishedAt: Number(job.finishedAt || 0),
    userId: String(job.userId || ''),
    deviceDbId: String(job.deviceDbId || ''),
    deviceIdentity: String(job.deviceIdentity || ''),
    inputFileName: String(job.inputFileName || ''),
    outputFileName: String(job.outputFileName || ''),
    recordingId: String(job.recordingId || ''),
    objectKey: String(job.objectKey || ''),
    url: String(job.url || ''),
    signedUrl: String(job.signedUrl || ''),
    error: String(job.error || '')
  }
}

async function cleanupTmpPart(filePath) {
  try {
    await fs.unlink(filePath)
  } catch {}
}

async function cleanupStaleUploadSessions() {
  const now = nowMs()
  for (const [key, session] of uploadSessionMap.entries()) {
    const ts = Number(session?.updatedAt) || 0
    if (!ts || (now - ts) > UPLOAD_SESSION_STALE_MS) {
      uploadSessionMap.delete(key)
      const partPath = String(session?.partPath || '')
      if (partPath) {
        await cleanupTmpPart(partPath)
      }
    }
  }
}

function queueAsyncUploadJob(jobInput) {
  const now = nowMs()
  const jobId = `watch_up_${now}_${Math.floor(Math.random() * 1000000)}`
  const job = {
    id: jobId,
    status: 'queued',
    attempt: 0,
    maxRetries: ASYNC_UPLOAD_MAX_RETRIES,
    queuedAt: now,
    startedAt: 0,
    finishedAt: 0,
    error: '',
    outputFileName: '',
    objectKey: '',
    url: '',
    signedUrl: '',
    ...jobInput
  }
  asyncUploadQueue.push(job)
  asyncUploadJobMap.set(job.id, job)
  pushRecentAsyncJob(snapshotAsyncJob(job))
  setTimeout(() => {
    void runAsyncUploadQueue()
  }, 0)
  return job
}

async function runAsyncUploadQueue() {
  if (asyncUploadRunning) return
  asyncUploadRunning = true
  try {
    while (asyncUploadQueue.length > 0) {
      const job = asyncUploadQueue.shift()
      if (!job) continue
      await runOneAsyncUploadJob(job)
    }
  } finally {
    asyncUploadRunning = false
  }
}

async function runOneAsyncUploadJob(job) {
  job.status = 'running'
  job.startedAt = nowMs()
  job.attempt = 0
  job.error = ''
  pushRecentAsyncJob(snapshotAsyncJob(job))

  while (job.attempt < job.maxRetries) {
    job.attempt += 1
    try {
      const done = await processAsyncUploadJob(job)
      job.status = 'success'
      job.finishedAt = nowMs()
      job.outputFileName = String(done.outputFileName || '')
      job.objectKey = String(done.objectKey || '')
      job.url = String(done.url || '')
      job.signedUrl = String(done.signedUrl || '')
      job.error = ''
      asyncUploadJobMap.set(job.id, job)
      pushRecentAsyncJob(snapshotAsyncJob(job))
      return
    } catch (error) {
      const text = String(error && error.message ? error.message : error)
      job.error = text
      asyncUploadJobMap.set(job.id, job)
      pushRecentAsyncJob(snapshotAsyncJob(job))
      if (job.attempt >= job.maxRetries) {
        job.status = 'failed'
        job.finishedAt = nowMs()
        asyncUploadJobMap.set(job.id, job)
        pushRecentAsyncJob(snapshotAsyncJob(job))
        console.error('[watch-upload-async] failed', {
          jobId: job.id,
          uploadId: job.uploadId,
          attempt: job.attempt,
          error: text
        })
        return
      }
      await wait(ASYNC_UPLOAD_RETRY_DELAY_MS * job.attempt)
    }
  }
}

async function processAsyncUploadJob(job) {
  const localFileName = safeFileName(job.localFileName)
  const localPath = join(UPLOAD_DIR, localFileName)
  await fs.access(localPath)

  let outputFileName = localFileName
  if (extname(localFileName).toLowerCase() === '.opus') {
    const converted = await enqueueMp3Convert({
      uploadDir: UPLOAD_DIR,
      opusFileName: localFileName,
      overwrite: true,
      removeSource: true,
      source: 'watch-upload-chunk-async'
    })
    outputFileName = String(converted?.filename || '') || localFileName
  }

  const outputPath = join(UPLOAD_DIR, outputFileName)
  let durationSec = 0
  try {
    durationSec = await probeAudioDurationSec(outputPath)
  } catch (error) {
    console.warn('[watch-upload-async] probe duration failed', {
      jobId: String(job.id || ''),
      fileName: outputFileName,
      error: String(error?.message || error)
    })
  }

  const fileBuffer = await fs.readFile(outputPath)
  const objectFileName = buildObjectFileName(outputFileName, job.userId)
  const config = await readConfigForUser(job.userId)
  const uploaded = await uploadBufferToOss(config, fileBuffer, objectFileName, {
    signedUrlExpiresSec: config?.aliyun?.oss?.asrSignedUrlExpiresSec
  })

  const recording = await insertRecordingMetadata({
    userId: String(job.userId || ''),
    deviceId: String(job.deviceDbId || ''),
    fileName: outputFileName,
    ossKey: String(uploaded.objectKey || ''),
    ossUrl: uploaded.url || uploaded.signedUrl || '',
    ossBucket: String(uploaded.bucket || ''),
    sizeBytes: fileBuffer.length,
    durationSec,
    status: 'uploaded'
  })

  job.recordingId = String(recording?.id || '')

  const cleanupPaths = new Set([outputPath])
  if (localPath !== outputPath) cleanupPaths.add(localPath)
  for (const path of cleanupPaths) {
    try {
      await fs.unlink(path)
    } catch {}
  }

  console.log('[watch-upload-async] success', {
    jobId: job.id,
    uploadId: job.uploadId,
    outputFileName,
    objectKey: uploaded.objectKey
  })

  return {
    recordingId: String(recording?.id || ''),
    outputFileName,
    objectKey: uploaded.objectKey || '',
    url: uploaded.url || uploaded.signedUrl || '',
    signedUrl: uploaded.signedUrl || ''
  }
}

function makeClientError(errorText) {
  const text = String(errorText || '请求无效')
  return Response.json(
    { success: false, error: text },
    { status: 400, headers: withCorsHeaders() }
  )
}

function makeSequenceConflictError(expectedNext) {
  const next = Number(expectedNext)
  return Response.json(
    {
      success: false,
      error: `分片顺序错误，期望 index=${next}`,
      expectedNext: Number.isInteger(next) ? next : 0
    },
    { status: 409, headers: withCorsHeaders() }
  )
}

function makeAuthError(errorText) {
  return Response.json(
    { success: false, error: String(errorText || '鉴权失败') },
    { status: 401, headers: withCorsHeaders() }
  )
}

export async function POST(request) {
  let sessionCacheKey = ''
  const configError = getSupabaseConfigError()
  if (configError) {
    return Response.json(
      { success: false, error: configError },
      { status: 500, headers: withCorsHeaders() }
    )
  }

  let parsed = null
  try {
    await ensureDirs()
    await cleanupStaleUploadSessions()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return makeClientError('payload 无效')
    }

    try {
      parsed = parseRequestBody(body)
    } catch (clientError) {
      return makeClientError(String(clientError?.message || clientError))
    }

    const deviceIdentity = normalizeDeviceIdentity(body)
    const sessionToken = normalizeSessionToken(request, body)
    if (!deviceIdentity) {
      return makeClientError('deviceId 不能为空')
    }
    if (!sessionToken) {
      return makeAuthError('缺少设备会话 token，请先绑定配对码')
    }

    let auth
    try {
      auth = await validateDeviceSessionForUpload(deviceIdentity, sessionToken)
    } catch (authError) {
      return makeAuthError(String(authError?.message || authError))
    }

    const userId = String(auth.userId || '')
    const deviceDbId = String(auth.device?.id || '')
    const cacheKey = buildUploadSessionKey(userId, parsed.uploadId)
    sessionCacheKey = cacheKey
    const partPath = join(TMP_DIR, toPartFileNameFromSessionKey(cacheKey))

    let session = uploadSessionMap.get(cacheKey)
    if (!session) {
      if (parsed.firstIndex !== 0) {
        return makeClientError('缺少初始分片，请从第1片重新上传')
      }
      session = {
        uploadId: cacheKey,
        partPath,
        deviceIdentity,
        userId,
        deviceDbId,
        fileName: parsed.fileName,
        total: parsed.total,
        declaredSize: parsed.size,
        nextIndex: 0,
        receivedBytes: 0,
        createdAt: nowMs(),
        updatedAt: nowMs()
      }
      uploadSessionMap.set(cacheKey, session)
      await cleanupTmpPart(partPath)
    }

    if (session.deviceIdentity !== deviceIdentity) {
      uploadSessionMap.delete(cacheKey)
      await cleanupTmpPart(partPath)
      return makeClientError('uploadId 与设备不匹配')
    }
    if (session.userId !== userId) {
      uploadSessionMap.delete(cacheKey)
      await cleanupTmpPart(partPath)
      return makeAuthError('uploadId 与当前账号会话不匹配，请重新上传')
    }
    if (session.total !== parsed.total) {
      uploadSessionMap.delete(cacheKey)
      await cleanupTmpPart(partPath)
      return makeClientError('total 与历史分片不一致')
    }
    if (session.fileName !== parsed.fileName) {
      uploadSessionMap.delete(cacheKey)
      await cleanupTmpPart(partPath)
      return makeClientError('fileName 与历史分片不一致')
    }
    if (parsed.firstIndex !== session.nextIndex) {
      return makeSequenceConflictError(session.nextIndex)
    }

    let incomingBytes = 0
    for (const part of parsed.chunks) {
      incomingBytes += Number(part?.buffer?.length || 0)
    }
    const nextBytes = Number(session.receivedBytes || 0) + incomingBytes
    if (nextBytes > MAX_UPLOAD_BYTES) {
      uploadSessionMap.delete(cacheKey)
      await cleanupTmpPart(partPath)
      return makeClientError(`文件过大，最大 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`)
    }

    for (const part of parsed.chunks) {
      await fs.appendFile(partPath, part.buffer)
    }

    session.receivedBytes = nextBytes
    session.nextIndex = parsed.lastIndex + 1
    session.updatedAt = nowMs()

    if (parsed.lastIndex < parsed.total - 1) {
      return Response.json(
        {
          success: true,
          done: false,
          next: session.nextIndex,
          acceptedCount: parsed.chunks.length
        },
        { headers: withCorsHeaders() }
      )
    }

    const finalFileName = await buildUniqueFileName(session.fileName)
    const finalPath = join(UPLOAD_DIR, finalFileName)
    await fs.rename(partPath, finalPath)
    uploadSessionMap.delete(cacheKey)

    const asyncJob = queueAsyncUploadJob({
      uploadId: parsed.uploadId,
      userId,
      deviceDbId,
      deviceIdentity,
      localFileName: finalFileName
    })

    return Response.json(
      {
        success: true,
        done: true,
        queued: true,
        queueStatus: asyncJob.status,
        queueJobId: asyncJob.id,
        fileName: finalFileName,
        size: session.receivedBytes,
        url: ''
      },
      { headers: withCorsHeaders() }
    )
  } catch (error) {
    if (sessionCacheKey) {
      const stale = uploadSessionMap.get(sessionCacheKey)
      uploadSessionMap.delete(sessionCacheKey)
      if (stale && stale.partPath) {
        await cleanupTmpPart(stale.partPath)
      }
    }
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500, headers: withCorsHeaders() }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: withCorsHeaders()
  })
}
