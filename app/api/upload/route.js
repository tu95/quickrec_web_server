import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { networkInterfaces } from 'os'
import { readConfigForUser } from '../_lib/config-store'
import { createMeetingJob } from '../_lib/meeting-notes'
import { requireUserAuth } from '../_lib/user-auth'
import { ingestUploadedLocalFile } from '../_lib/upload-ingest'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

// 确保上传目录存在
async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR)
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
  }
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
  return String(name || '').replace(/[\/\\]/g, '_') || `recording_${Date.now()}.opus`
}

export async function POST(request) {
  try {
    await ensureUploadDir()
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

    // 使用 multiparty 需要 Node.js 的 req 对象
    // Next.js App Router 中需要转换
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file) {
      return Response.json(
        { success: false, error: 'No file provided' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 生成文件名（避免重复）
    const originalName = safeFileName(file.name || `recording_${Date.now()}.opus`)
    let filename = originalName
    let counter = 1

    while (true) {
      try {
        const filepath = join(UPLOAD_DIR, filename)
        await fs.access(filepath)
        // 文件存在，添加序号
        const ext = originalName.includes('.')
          ? originalName.slice(originalName.lastIndexOf('.'))
          : ''
        const base = originalName.replace(ext, '')
        filename = `${base}_${counter}${ext}`
        counter++
      } catch {
        // 文件不存在，可以使用这个名字
        break
      }
    }

    const filepath = join(UPLOAD_DIR, filename)
    await fs.writeFile(filepath, buffer)

    const origin = getRequestOrigin(request)
    let sourceUrl = ''
    let mp3Filename = ''
    let mp3Url = ''
    let autoConvertError = ''
    let autoMeetingJobId = ''
    let autoMeetingError = ''
    let outputFilename = filename
    let outputSize = buffer.length
    let recordingId = ''
    let fileUrl = ''

    try {
      const ingested = await ingestUploadedLocalFile({
        userId,
        localFilePath: filepath,
        fileName: filename,
        source: 'upload'
      })
      outputFilename = String(ingested.outputFileName || filename)
      outputSize = Number(ingested.sizeBytes || buffer.length)
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
            origin: 'auto-upload',
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
        recordingId,
        filename: outputFilename,
        size: outputSize,
        sourceUrl,
        mp3Filename,
        mp3Url,
        autoConverted: !!mp3Url,
        autoConvertError,
        autoMeetingJobId,
        autoMeetingError,
        url: primaryUrl,
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[Upload Error]', error)
    return Response.json(
      { success: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

// 健康检查
export async function GET(request) {
  // 获取本机 IP
  const nets = networkInterfaces()
  let localIP = 'localhost'
  for (const name in nets) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address
        break
      }
    }
  }

  return Response.json(
    {
      success: true,
      server: 'zepp-recorder-upload-server',
      version: '1.0.0',
      timestamp: Date.now(),
      localIP: localIP,
      origin: getRequestOrigin(request),
      uploadAutoConvertMp3: true,
      endpoints: {
        upload: 'POST /api/upload',
        uploadTest: 'POST /api/upload-test',
        uploadChunk: 'POST /api/upload-chunk',
        convertMp3: 'POST /api/convert-mp3',
        files: 'GET /api/files',
        fileDelete: 'DELETE /api/files/{recordingId}',
      },
    },
    { headers: CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  })
}
