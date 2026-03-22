import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { readConfigForUser } from '../_lib/config-store'
import { createMeetingJob } from '../_lib/meeting-notes'
import {
  buildUploadSessionKey,
  buildUploadSessionPartPath,
  cleanupStaleUploadSessions,
  cleanupTmpPart,
  deleteUploadSession,
  getUploadSession,
  runChunkSessionExclusive,
  setUploadSession
} from '../_lib/upload-chunk-session'
import { requireUserAuth } from '../_lib/user-auth'
import { ingestUploadedLocalFile } from '../_lib/upload-ingest'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const TMP_DIR = join(process.cwd(), 'uploads_tmp')
const UPLOAD_SESSION_STALE_MS = 25 * 60 * 1000
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

// 这个函数主要是确保上传目录和临时目录都存在。
async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  await fs.mkdir(TMP_DIR, { recursive: true })
}

// 这个函数主要是把文件名清理成安全名字。
function safeFileName(name) {
  return String(name || '').replace(/[\/\\]/g, '_') || `recording_${Date.now()}.opus`
}

// 这个函数主要是算出当前请求的站点地址。
function getRequestOrigin(request) {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`
  }

  const host = request.headers.get('host')
  if (host) {
    const proto = forwardedProto || (request.url.startsWith('https://') ? 'https' : 'http')
    return `${proto}://${host}`
  }

  return new URL(request.url).origin
}

// 这个函数主要是把 base64 文本洗成可解码的格式。
function normalizeBase64(data) {
  const raw = String(data || '')
  if (!raw) return null

  const head = raw.slice(0, 64).toLowerCase()
  const comma = raw.indexOf(',')
  const payload = head.startsWith('data:') && comma > -1 ? raw.slice(comma + 1) : raw

  const cleaned = payload
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '')

  if (!cleaned) return null
  const remainder = cleaned.length % 4
  const padded = remainder === 0 ? cleaned : cleaned + '='.repeat(4 - remainder)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) return null
  return padded
}

// 这个函数主要是把单个分片解成 Buffer。
function decodeBase64Chunk(data) {
  const normalized = normalizeBase64(data)
  if (!normalized) throw new Error('invalid base64 chunk')
  const chunk = Buffer.from(normalized, 'base64')
  if (!chunk.length) throw new Error('empty chunk')
  return chunk
}

// 这个函数主要是给最终文件挑一个不冲突的名字。
async function buildUniqueFileName(originalName) {
  const safeName = safeFileName(originalName)
  let filename = safeName
  let counter = 1

  while (true) {
    try {
      await fs.access(join(UPLOAD_DIR, filename))
      const ext = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : ''
      const base = safeName.replace(ext, '')
      filename = `${base}_${counter}${ext}`
      counter++
    } catch {
      return filename
    }
  }
}

// 这个函数主要是统一返回参数错误。
function makeClientError(errorText, status = 400, extra = null) {
  return Response.json(
    Object.assign({ success: false, error: String(errorText || 'invalid payload') }, extra || {}),
    { status, headers: CORS_HEADERS }
  )
}

// 这个函数主要是把分片顺序冲突变成明确响应。
function makeSequenceConflictError(expectedNext) {
  return makeClientError(
    `chunk index out of order, expected ${Number(expectedNext) || 0}`,
    409,
    { expectedNext: Number(expectedNext) || 0 }
  )
}

// 这个接口主要处理 Web 分片上传，并严格校验分片顺序。
export async function POST(request) {
  let sessionCacheKey = ''
  try {
    await ensureDirs()
    await cleanupStaleUploadSessions(UPLOAD_SESSION_STALE_MS)
    const auth = await requireUserAuth(request)
    if (!auth.ok) {
      return Response.json(
        { success: false, error: auth.error || '未登录' },
        { status: auth.status || 401, headers: CORS_HEADERS }
      )
    }
    const userId = String(auth.user?.id || '').trim()
    if (!userId) {
      return Response.json(
        { success: false, error: '用户信息无效，请重新登录' },
        { status: 401, headers: CORS_HEADERS }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return makeClientError('invalid payload')
    }

    const uploadId = String(body.uploadId || '')
    const fileName = safeFileName(body.fileName)
    const index = Number(body.index)
    const total = Number(body.total)
    const data = body.data

    if (!uploadId || !Number.isInteger(index) || !Number.isInteger(total) || total <= 0 || index < 0 || index >= total || !data) {
      return makeClientError('invalid payload')
    }

    let chunk
    try {
      chunk = decodeBase64Chunk(data)
    } catch (error) {
      return makeClientError(error.message || 'invalid base64 chunk')
    }

    const cacheKey = buildUploadSessionKey(userId, uploadId, 'web')
    sessionCacheKey = cacheKey

    return await runChunkSessionExclusive(cacheKey, async () => {
      const partPath = buildUploadSessionPartPath(TMP_DIR, cacheKey)
      let session = getUploadSession(cacheKey)

      // index=0 只在「新会话」或「尚未写入任何分片」时允许清盘；进行中再收到 0 视为乱序，避免重试误删 .part。
      if (index === 0) {
        const progressed = session && Number(session.nextExpectedIndex) > 0
        if (progressed) {
          return makeSequenceConflictError(session.nextExpectedIndex)
        }
        deleteUploadSession(cacheKey)
        await cleanupTmpPart(partPath)
        session = null
      }

      if (!session) {
        if (index !== 0) {
          return makeClientError('missing initial chunk, please restart from index 0', 409)
        }
        session = {
          uploadId,
          userId,
          fileName,
          total,
          nextExpectedIndex: 0,
          partPath,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        setUploadSession(cacheKey, session)
      }

      if (session.userId !== userId) {
        return makeClientError('upload session mismatch', 409)
      }
      if (session.fileName !== fileName) {
        return makeClientError('fileName mismatch for upload session', 409)
      }
      if (session.total !== total) {
        return makeClientError('total mismatch for upload session', 409)
      }
      if (index !== session.nextExpectedIndex) {
        return makeSequenceConflictError(session.nextExpectedIndex)
      }

      await fs.appendFile(partPath, chunk)
      session.nextExpectedIndex = index + 1
      session.updatedAt = Date.now()
      setUploadSession(cacheKey, session)

      if (index === total - 1) {
        if (session.nextExpectedIndex !== total) {
          return makeClientError('upload is incomplete, please restart from index 0')
        }
        const finalName = await buildUniqueFileName(fileName)
        const finalPath = join(UPLOAD_DIR, finalName)
        await fs.rename(partPath, finalPath)
        deleteUploadSession(cacheKey)

        const origin = getRequestOrigin(request)
        let sourceUrl = ''
        let mp3Filename = ''
        let mp3Url = ''
        let autoConvertError = ''
        let autoMeetingJobId = ''
        let autoMeetingError = ''
        let outputFilename = finalName
        let recordingId = ''
        let fileUrl = ''
        try {
          const ingested = await ingestUploadedLocalFile({
            userId,
            localFilePath: finalPath,
            fileName: finalName,
            source: 'upload-chunk'
          })
          outputFilename = String(ingested.outputFileName || finalName)
          recordingId = String(ingested.recordingId || '')
          fileUrl = recordingId ? `${origin}/api/files/${encodeURIComponent(recordingId)}` : ''
          if (ingested.autoConverted) {
            mp3Filename = outputFilename
            mp3Url = fileUrl
          } else {
            sourceUrl = fileUrl
          }
        } catch (error) {
          autoConvertError = String(error && error.message ? error.message : error)
          throw error
        }
        const primaryUrl = fileUrl || mp3Url || sourceUrl
        if (extname(outputFilename).toLowerCase() === '.mp3') {
          try {
            const config = await readConfigForUser(userId)
            if (config?.meeting?.autoGenerateOnMp3Upload === true) {
              const job = await createMeetingJob({
                recordingId,
                fileName: outputFilename,
                origin: 'auto-upload-chunk',
                userId
              })
              autoMeetingJobId = String(job?.id || '')
            }
          } catch (error) {
            autoMeetingError = String(error && error.message ? error.message : error)
          }
        }
        return Response.json(
          {
            success: true,
            done: true,
            recordingId,
            filename: outputFilename,
            sourceUrl,
            mp3Filename,
            mp3Url,
            autoConverted: !!mp3Url,
            autoConvertError,
            autoMeetingJobId,
            autoMeetingError,
            url: primaryUrl
          },
          { headers: CORS_HEADERS }
        )
      }

      return Response.json(
        { success: true, done: false, next: session.nextExpectedIndex },
        { headers: CORS_HEADERS }
      )
    })
  } catch (error) {
    if (sessionCacheKey) {
      const stale = getUploadSession(sessionCacheKey)
      deleteUploadSession(sessionCacheKey)
      if (stale?.partPath) {
        await cleanupTmpPart(stale.partPath)
      }
    }
    return Response.json(
      { success: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
