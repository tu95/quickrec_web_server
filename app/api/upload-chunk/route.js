import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { enqueueMp3Convert } from '../_lib/mp3-queue'
import { readConfig } from '../_lib/config-store'
import { createMeetingJob } from '../_lib/meeting-notes'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const TMP_DIR = join(process.cwd(), 'uploads_tmp')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  await fs.mkdir(TMP_DIR, { recursive: true })
}

function safeFileName(name) {
  return String(name || '').replace(/[\/\\]/g, '_') || `recording_${Date.now()}.opus`
}

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

function decodeBase64Chunk(data) {
  const normalized = normalizeBase64(data)
  if (!normalized) throw new Error('invalid base64 chunk')
  const chunk = Buffer.from(normalized, 'base64')
  if (!chunk.length) throw new Error('empty chunk')
  return chunk
}

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

export async function POST(request) {
  try {
    await ensureDirs()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return Response.json(
        { success: false, error: 'invalid payload' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const uploadId = String(body.uploadId || '')
    const fileName = safeFileName(body.fileName)
    const index = Number(body.index)
    const total = Number(body.total)
    const data = body.data

    if (!uploadId || !Number.isInteger(index) || !Number.isInteger(total) || total <= 0 || index < 0 || index >= total || !data) {
      return Response.json(
        { success: false, error: 'invalid payload' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    let chunk
    try {
      chunk = decodeBase64Chunk(data)
    } catch (error) {
      return Response.json(
        { success: false, error: error.message || 'invalid base64 chunk' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const partPath = join(TMP_DIR, `${uploadId}.part`)

    if (index === 0) {
      try {
        await fs.unlink(partPath)
      } catch {}
    }

    await fs.appendFile(partPath, chunk)

    if (index === total - 1) {
      const finalName = await buildUniqueFileName(fileName)
      const finalPath = join(UPLOAD_DIR, finalName)
      await fs.rename(partPath, finalPath)

      const origin = getRequestOrigin(request)
      let sourceUrl = `${origin}/api/files/${encodeURIComponent(finalName)}`
      let mp3Filename = ''
      let mp3Url = ''
      let autoConvertError = ''
      let autoMeetingJobId = ''
      let autoMeetingError = ''
      let outputFilename = finalName
      if (extname(finalName).toLowerCase() === '.opus') {
        try {
          const converted = await enqueueMp3Convert({
            uploadDir: UPLOAD_DIR,
            opusFileName: finalName,
            overwrite: true,
            removeSource: true,
            source: 'upload-chunk',
          })
          mp3Filename = converted.filename
          mp3Url = `${origin}/api/files/${encodeURIComponent(converted.filename)}`
          outputFilename = converted.filename
          sourceUrl = ''
        } catch (error) {
          autoConvertError = String(error && error.message ? error.message : error)
          console.error('[upload-chunk] auto convert mp3 failed', {
            filename: finalName,
            error: autoConvertError,
            stack: error && error.stack ? String(error.stack) : ''
          })
        }
      }
      const primaryUrl = mp3Url || sourceUrl
      if (extname(outputFilename).toLowerCase() === '.mp3') {
        try {
          const config = await readConfig()
          if (config?.meeting?.autoGenerateOnMp3Upload === true) {
            const job = await createMeetingJob({
              fileName: outputFilename,
              origin: 'auto-upload-chunk'
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
      { success: true, done: false, next: index + 1 },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
