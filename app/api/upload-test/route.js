import { promises as fs } from 'fs'
import { join } from 'path'
import { requireUserAuth } from '../_lib/user-auth'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
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

function safeFileName(name) {
  return String(name || '').replace(/[\/\\]/g, '_')
}

function normalizeBase64(data) {
  const raw = String(data || '')
  if (!raw) return ''
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '')
  if (!cleaned) return ''
  const remainder = cleaned.length % 4
  return remainder === 0 ? cleaned : cleaned + '='.repeat(4 - remainder)
}

export async function POST(request) {
  try {
    const auth = await requireUserAuth(request)
    if (!auth?.ok) {
      return Response.json(
        { success: false, error: String(auth?.error || '未登录') },
        { status: Number(auth?.status) || 401, headers: CORS_HEADERS }
      )
    }

    await ensureUploadDir()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return Response.json(
        { success: false, error: 'invalid payload' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const origin = getRequestOrigin(request)
    const fileName = safeFileName(body.fileName || `api_test_${Date.now()}.txt`) || `api_test_${Date.now()}.txt`
    const text = typeof body.text === 'string' ? body.text : ''
    const base64 = normalizeBase64(body.data || body.contentBase64 || '')

    let buffer = null
    if (base64) {
      buffer = Buffer.from(base64, 'base64')
    } else if (text) {
      buffer = Buffer.from(text, 'utf8')
    } else {
      return Response.json(
        { success: false, error: 'payload requires text or base64 data' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!buffer || !buffer.length) {
      return Response.json(
        { success: false, error: 'empty test content' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const finalName = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`
    const filePath = join(UPLOAD_DIR, finalName)
    await fs.writeFile(filePath, buffer)

    return Response.json(
      {
        success: true,
        endpoint: '/api/upload-test',
        filename: finalName,
        size: buffer.length,
        url: `${origin}/api/files/${encodeURIComponent(finalName)}`,
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || String(error) },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
