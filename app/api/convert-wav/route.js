import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { convertOpusFileToWav } from '../_lib/opus-wav'

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

export async function POST(request) {
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
      { success: false, error: 'only .opus files can be converted to wav' },
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
    const converted = await convertOpusFileToWav({
      uploadDir: UPLOAD_DIR,
      opusFileName: fileName,
      overwrite: !!(body && body.overwrite),
    })
    return Response.json(
      {
        success: true,
        converted: !converted.reused,
        source: fileName,
        filename: converted.filename,
        size: converted.size,
        url: `${getRequestOrigin(request)}/api/files/${encodeURIComponent(converted.filename)}`
      },
      { headers: CORS_HEADERS }
    )
  } catch (err) {
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
