import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { requireSiteAuth } from '../../_lib/admin-auth'
import { readConfigForUser } from '../../_lib/config-store'
import { deleteOssObject, getOssObject } from '../../_lib/oss-storage'
import {
  deleteUserRecordingById,
  getUserRecordingById
} from '../../_lib/recorder-multiuser-store'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

function normalizeRecordingId(raw) {
  return String(raw || '').trim()
}

function getContentType(fileName) {
  const ext = String(fileName || '').toLowerCase().split('.').pop()
  const types = {
    mp3: 'audio/mpeg',
    opus: 'audio/opus',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    txt: 'text/plain',
    json: 'application/json',
    pdf: 'application/pdf'
  }
  return types[ext] || 'application/octet-stream'
}

async function cleanupLocalLegacyFile(fileName) {
  const safeName = String(fileName || '').trim()
  if (!safeName) return
  const ext = extname(safeName).toLowerCase()
  const targets = [safeName]
  if (ext === '.opus' || ext === '.mp3') {
    const base = safeName.slice(0, -ext.length)
    targets.push(`${base}.opus`, `${base}.mp3`)
  }
  for (const name of targets) {
    const path = join(UPLOAD_DIR, name)
    try {
      await fs.unlink(path)
    } catch {}
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

  const userId = String(auth.user?.id || '').trim()
  const routeParams = await params
  const recordingId = normalizeRecordingId(routeParams?.name)
  if (!recordingId) {
    return Response.json(
      { success: false, error: 'invalid recording id' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  try {
    const requestUrl = new URL(request.url)
    const downloadParam = String(requestUrl.searchParams.get('download') || '').trim().toLowerCase()
    const asAttachment = downloadParam === '1' || downloadParam === 'true'
    const recording = await getUserRecordingById(userId, recordingId)
    if (!recording) {
      return Response.json(
        { success: false, error: 'file not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const ossKey = String(recording?.oss_key || '').trim()
    const ossBucket = String(recording?.oss_bucket || '').trim()
    if (!ossKey) {
      return Response.json(
        { success: false, error: '文件不存在' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const config = await readConfigForUser(userId)
    const ossResult = await getOssObject(config, ossKey, { ossBucket })

    if (!ossResult) {
      return Response.json(
        { success: false, error: '文件不存在' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const fileName = String(recording?.file_name || recordingId)
    const contentType = getContentType(fileName)

    return new Response(ossResult.content, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }

  const userId = String(auth.user?.id || '').trim()
  const routeParams = await params
  const recordingId = normalizeRecordingId(routeParams?.name)
  if (!recordingId) {
    return Response.json(
      { success: false, error: 'invalid recording id' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  try {
    const recording = await getUserRecordingById(userId, recordingId)
    if (!recording) {
      return Response.json(
        { success: false, error: 'file not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const config = await readConfigForUser(userId)
    const ossKey = String(recording?.oss_key || '').trim()
    const ossBucket = String(recording?.oss_bucket || '').trim()
    if (ossKey) {
      await deleteOssObject(config, ossKey, { ossBucket })
    }

    const deleted = await deleteUserRecordingById(userId, recordingId)
    if (!deleted?.deleted) {
      return Response.json(
        { success: false, error: '删除失败，请重试' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    await cleanupLocalLegacyFile(String(recording?.file_name || ''))

    return Response.json(
      {
        success: true,
        deleted: [String(recordingId)]
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
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
