import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { requireSiteAuth } from '../../_lib/admin-auth'
import { readConfigForUser } from '../../_lib/config-store'
import { deleteOssObject, signOssObjectUrl } from '../../_lib/oss-storage'
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

function buildDirectDownloadUrl(recording, config) {
  const key = String(recording?.oss_key || '').trim()
  const direct = String(recording?.oss_url || '').trim()
  if (key && config) {
    const signed = signOssObjectUrl(config, key, {
      signedUrlExpiresSec: config?.aliyun?.oss?.asrSignedUrlExpiresSec
    })
    return String(signed?.signedUrl || signed?.url || direct)
  }
  return direct
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
  const recordingId = normalizeRecordingId(params?.name)
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
    const targetUrl = buildDirectDownloadUrl(recording, config)
    if (!targetUrl) {
      return Response.json(
        { success: false, error: '文件下载地址不可用' },
        { status: 404, headers: CORS_HEADERS }
      )
    }
    return new Response(null, {
      status: 302,
      headers: {
        ...CORS_HEADERS,
        Location: targetUrl
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
  const recordingId = normalizeRecordingId(params?.name)
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
    if (ossKey) {
      await deleteOssObject(config, ossKey)
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
