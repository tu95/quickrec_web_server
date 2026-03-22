import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { enqueueMp3Convert } from '../_lib/mp3-queue'
import { requireSiteAuth } from '../_lib/admin-auth'
import { logRuntimeError } from '../_lib/runtime-log'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
}

function sanitizeFileName(rawName) {
  let decoded = ''
  try {
    decoded = decodeURIComponent(String(rawName || ''))
  } catch {
    return null
  }
  const safeName = basename(decoded)
  if (!safeName || safeName === '.' || safeName === '..' || safeName !== decoded) {
    return null
  }
  return safeName
}

// 这个接口主要是把本地 opus 转成 mp3，但不会伪造正式播放地址。
export async function POST(request) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }
  await ensureUploadDir()

  const body = await request.json().catch(() => null)
  const rawName = body && typeof body === 'object' ? (body.name || body.fileName) : ''
  const fileName = sanitizeFileName(rawName)

  if (!fileName) {
    return Response.json(
      { success: false, error: 'invalid filename' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  if (extname(fileName).toLowerCase() !== '.opus') {
    return Response.json(
      { success: false, error: 'only .opus files can be converted to mp3' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const inputPath = join(UPLOAD_DIR, fileName)
  try {
    await fs.access(inputPath)
  } catch {
    return Response.json(
      { success: false, error: 'source file not found' },
      { status: 404, headers: CORS_HEADERS }
    )
  }

  try {
    const converted = await enqueueMp3Convert({
      uploadDir: UPLOAD_DIR,
      opusFileName: fileName,
      overwrite: !!(body && body.overwrite),
      removeSource: true,
      source: 'manual-api',
    })
    return Response.json(
      {
        success: true,
        converted: !converted.reused,
        source: fileName,
        filename: converted.filename,
        size: converted.size,
        url: null,
        warning: '仅本地文件，暂无正式播放 URL'
      },
      { headers: CORS_HEADERS }
    )
  } catch (err) {
    await logRuntimeError('audio.convert_mp3.failed', {
      fileName,
      overwrite: !!(body && body.overwrite),
      error: String(err && err.message ? err.message : err),
      stack: err && err.stack ? String(err.stack) : ''
    })
    console.error('[convert-mp3] convert failed', {
      fileName,
      error: String(err && err.message ? err.message : err),
      stack: err && err.stack ? String(err.stack) : ''
    })
    return Response.json(
      { success: false, error: String(err && err.message ? err.message : err) },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  })
}
