import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { requireSiteAuth } from '../../_lib/admin-auth'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

const MIME_TYPES = {
  '.opus': 'audio/opus',
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
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

function parseSingleRange(rangeHeader, totalSize) {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim())
  if (!match) return { error: 'invalid range format' }

  const startRaw = match[1]
  const endRaw = match[2]
  if (!startRaw && !endRaw) {
    return { error: 'invalid empty range' }
  }

  let start = startRaw ? Number(startRaw) : null
  let end = endRaw ? Number(endRaw) : null

  if (start === null) {
    if (!Number.isFinite(end) || end <= 0) {
      return { error: 'invalid suffix range' }
    }
    const suffixLength = Math.floor(end)
    if (suffixLength >= totalSize) {
      start = 0
    } else {
      start = totalSize - suffixLength
    }
    end = totalSize - 1
  } else {
    if (!Number.isFinite(start) || start < 0) {
      return { error: 'invalid start range' }
    }
    start = Math.floor(start)

    if (end === null || !Number.isFinite(end)) {
      end = totalSize - 1
    } else {
      end = Math.floor(end)
    }

    if (start >= totalSize) {
      return { unsatisfiable: true }
    }
    if (end < start) {
      return { error: 'invalid range order' }
    }
    if (end >= totalSize) {
      end = totalSize - 1
    }
  }

  return { start, end }
}

async function readFileChunk(filePath, start, end) {
  const byteLength = end - start + 1
  const fileHandle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(byteLength)
    const { bytesRead } = await fileHandle.read(buffer, 0, byteLength, start)
    return bytesRead === byteLength ? buffer : buffer.subarray(0, bytesRead)
  } finally {
    await fileHandle.close()
  }
}

export async function GET(request, { params }) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }

  const fileName = sanitizeFileName(params?.name)
  if (!fileName) {
    return Response.json(
      { success: false, error: 'invalid filename' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const filePath = join(UPLOAD_DIR, fileName)

  try {
    const stat = await fs.stat(filePath)
    const totalSize = Number(stat.size) || 0
    const contentType = MIME_TYPES[extname(fileName).toLowerCase()] || 'application/octet-stream'
    const baseHeaders = {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Accept-Ranges': 'bytes',
    }

    const rangeHeader = request.headers.get('range')
    const range = parseSingleRange(rangeHeader, totalSize)

    if (range && range.unsatisfiable) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${totalSize}`,
          'Content-Length': '0'
        }
      })
    }

    if (range && range.error) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${totalSize}`,
          'Content-Length': '0'
        }
      })
    }

    if (range && typeof range.start === 'number' && typeof range.end === 'number') {
      const chunkBuffer = await readFileChunk(filePath, range.start, range.end)
      return new Response(chunkBuffer, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
          'Content-Length': String(chunkBuffer.length),
        },
      })
    }

    const fileBuffer = await fs.readFile(filePath)
    return new Response(fileBuffer, {
      headers: {
        ...baseHeaders,
        'Content-Length': String(fileBuffer.length),
      },
    })
  } catch {
    return Response.json(
      { success: false, error: 'file not found' },
      { status: 404, headers: CORS_HEADERS }
    )
  }
}

export async function DELETE(_request, { params }) {
  const auth = await requireSiteAuth(_request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }

  const fileName = sanitizeFileName(params?.name)
  if (!fileName) {
    return Response.json(
      { success: false, error: 'invalid filename' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const filePath = join(UPLOAD_DIR, fileName)
  const deleted = []
  const ext = extname(fileName).toLowerCase()

  try {
    await fs.unlink(filePath)
    deleted.push(fileName)

    if (ext === '.opus' || ext === '.mp3') {
      const baseName = fileName.slice(0, -ext.length)
      for (const siblingName of [`${baseName}.opus`, `${baseName}.mp3`]) {
        if (siblingName === fileName) continue
        try {
          await fs.unlink(join(UPLOAD_DIR, siblingName))
          deleted.push(siblingName)
        } catch {}
      }
    }

    return Response.json(
      { success: true, deleted },
      { headers: CORS_HEADERS }
    )
  } catch {
    return Response.json(
      { success: false, error: 'file not found' },
      { status: 404, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
