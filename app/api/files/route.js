import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { requireSiteAuth } from '../_lib/admin-auth'
import { readConfigForUser } from '../_lib/config-store'
import { signOssObjectUrl } from '../_lib/oss-storage'
import { listUserRecordings } from '../_lib/recorder-multiuser-store'

const NOTES_DIR = join(process.cwd(), 'uploads', 'meeting_notes')
const JOBS_DIR = join(NOTES_DIR, 'jobs')
const MEETING_JOB_STALE_MS = (() => {
  const fallback = 30 * 60 * 1000
  const raw = Number(process.env.MEETING_JOB_STALE_MS || fallback)
  if (!Number.isFinite(raw)) return fallback
  const value = Math.floor(raw)
  if (value < 60 * 1000) return 60 * 1000
  return value
})()
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

function formatSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(size) / Math.log(k))
  return (size / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

function getFileCategory(name) {
  const lower = String(name || '').toLowerCase()
  if (lower.startsWith('api_test_')) return 'test'
  if (lower.endsWith('.txt') || lower.endsWith('.json') || lower.endsWith('.log')) return 'test'
  return 'recording'
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseTs(value) {
  const ts = new Date(String(value || '')).getTime()
  if (!Number.isFinite(ts) || ts <= 0) return 0
  return ts
}

function normalizeRecordingId(raw) {
  return String(raw || '').trim()
}

function normalizeUserId(raw) {
  return String(raw || '').trim()
}

function toClientMeetingJob(rawJob) {
  if (!rawJob || typeof rawJob !== 'object') return null
  const id = String(rawJob.id || '').trim()
  const fileName = String(rawJob.fileName || '').trim()
  if (!id || !fileName) return null
  return {
    id,
    recordingId: normalizeRecordingId(rawJob.recordingId),
    fileName,
    status: String(rawJob.status || '').trim(),
    stage: String(rawJob.stage || '').trim(),
    createdAt: toNumber(rawJob.createdAt),
    updatedAt: toNumber(rawJob.updatedAt),
    error: String(rawJob.error || '').trim(),
    result: rawJob.result && typeof rawJob.result === 'object'
      ? rawJob.result
      : null
  }
}

function normalizeJobStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function isLiveMeetingJobStatus(status) {
  const normalized = normalizeJobStatus(status)
  return normalized === 'queued' || normalized === 'running'
}

function getMeetingJobActivityTs(rawJob) {
  const updatedAt = toNumber(rawJob?.updatedAt)
  if (updatedAt > 0) return updatedAt
  const createdAt = toNumber(rawJob?.createdAt)
  if (createdAt > 0) return createdAt
  return 0
}

function collapseStaleMeetingJob(rawJob) {
  if (!rawJob || typeof rawJob !== 'object') {
    return { job: rawJob, changed: false }
  }
  if (!isLiveMeetingJobStatus(rawJob.status)) {
    return { job: rawJob, changed: false }
  }
  const activityTs = getMeetingJobActivityTs(rawJob)
  if (!activityTs) {
    return { job: rawJob, changed: false }
  }
  if ((Date.now() - activityTs) < MEETING_JOB_STALE_MS) {
    return { job: rawJob, changed: false }
  }
  const now = Date.now()
  const errorText = String(rawJob.error || '').trim() || '任务中断，请重试'
  return {
    job: {
      ...rawJob,
      status: 'failed',
      stage: 'error',
      error: errorText,
      updatedAt: now,
      failedAt: now
    },
    changed: true
  }
}

async function loadLatestNoteMap(userId) {
  const safeUserId = normalizeUserId(userId)
  const byRecordingId = new Map()
  const byFileName = new Map()
  try {
    const entries = await fs.readdir(NOTES_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.json')) continue

      const metadataPath = join(NOTES_DIR, entry.name)
      let metadata
      try {
        const text = await fs.readFile(metadataPath, 'utf8')
        metadata = JSON.parse(text)
      } catch {
        continue
      }
      if (normalizeUserId(metadata?.userId) !== safeUserId) {
        continue
      }

      const sourceFileName = String(metadata?.fileName || '').trim()
      const recordingId = normalizeRecordingId(metadata?.recordingId)
      const noteId = String(metadata?.id || entry.name.slice(0, -5)).trim()
      if (!noteId) continue
      const createdAt = toNumber(metadata?.createdAt)
      const noteTitle = String(metadata?.noteTitle || '').trim()
      const item = {
        noteId,
        noteUrl: `/notes/${encodeURIComponent(noteId)}`,
        createdAt,
        noteTitle
      }
      if (recordingId) {
        const prev = byRecordingId.get(recordingId)
        if (!prev || createdAt >= prev.createdAt) {
          byRecordingId.set(recordingId, item)
        }
      }
      if (sourceFileName) {
        const prevByName = byFileName.get(sourceFileName)
        if (!prevByName || createdAt >= prevByName.createdAt) {
          byFileName.set(sourceFileName, item)
        }
      }
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { byRecordingId, byFileName }
    }
    throw error
  }
  return { byRecordingId, byFileName }
}

async function loadLatestMeetingJobMap(userId) {
  const safeUserId = normalizeUserId(userId)
  const byRecordingId = new Map()
  const byFileName = new Map()
  try {
    const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.json')) continue

      const jobPath = join(JOBS_DIR, entry.name)
      let rawJob
      try {
        const text = await fs.readFile(jobPath, 'utf8')
        rawJob = JSON.parse(text)
      } catch {
        continue
      }
      if (normalizeUserId(rawJob?.userId) !== safeUserId) {
        continue
      }
      const collapsed = collapseStaleMeetingJob(rawJob)
      if (collapsed.changed) {
        rawJob = collapsed.job
        try {
          await fs.writeFile(jobPath, JSON.stringify(rawJob, null, 2), 'utf8')
        } catch {}
      }

      const job = toClientMeetingJob(rawJob)
      if (!job) continue
      const fileName = String(job.fileName || '')
      const recordingId = normalizeRecordingId(job.recordingId)
      const jobOrderTs = job.updatedAt || job.createdAt
      if (recordingId) {
        const previous = byRecordingId.get(recordingId)
        const prevOrderTs = toNumber(previous?.updatedAt) || toNumber(previous?.createdAt)
        if (!previous || jobOrderTs >= prevOrderTs) {
          byRecordingId.set(recordingId, job)
        }
      }
      if (fileName) {
        const previousByName = byFileName.get(fileName)
        const prevByNameTs = toNumber(previousByName?.updatedAt) || toNumber(previousByName?.createdAt)
        if (!previousByName || jobOrderTs >= prevByNameTs) {
          byFileName.set(fileName, job)
        }
      }
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { byRecordingId, byFileName }
    }
    throw error
  }
  return { byRecordingId, byFileName }
}

async function resolveRecordingUrls(recording, config) {
  const key = String(recording?.oss_key || '').trim()
  const bucket = String(recording?.oss_bucket || '').trim()
  const fileName = String(recording?.file_name || '').trim()
  const rawUrl = String(recording?.oss_url || '').trim()
  if (key && config) {
    try {
      const streamSigned = await signOssObjectUrl(config, key, {
        signedUrlExpiresSec: config?.aliyun?.oss?.asrSignedUrlExpiresSec,
        ossBucket: bucket
      })
      const downloadSigned = await signOssObjectUrl(config, key, {
        signedUrlExpiresSec: config?.aliyun?.oss?.asrSignedUrlExpiresSec,
        ossBucket: bucket,
        forceAttachment: true,
        downloadFileName: fileName || 'recording'
      })
      return {
        downloadUrl: String(downloadSigned?.signedUrl || streamSigned?.signedUrl || rawUrl),
        streamUrl: String(streamSigned?.signedUrl || streamSigned?.url || rawUrl),
        ossUrl: String(streamSigned?.signedUrl || rawUrl),
        signedUrl: String(streamSigned?.signedUrl || '')
      }
    } catch {}
  }
  if (rawUrl) {
    return {
      downloadUrl: rawUrl,
      streamUrl: rawUrl,
      ossUrl: rawUrl,
      signedUrl: ''
    }
  }
  return {
    downloadUrl: '',
    streamUrl: '',
    ossUrl: '',
    signedUrl: ''
  }
}

export async function GET(request) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }
  try {
    const userId = String(auth.user?.id || '').trim()
    const recordings = await listUserRecordings(userId, { limit: 500 })
    const [{ byRecordingId: noteByRecordingId, byFileName: noteByFileName }, { byRecordingId: jobByRecordingId, byFileName: jobByFileName }] = await Promise.all([
      loadLatestNoteMap(userId),
      loadLatestMeetingJobMap(userId)
    ])

    let userConfig = null
    try {
      userConfig = await readConfigForUser(userId)
    } catch {}

    const filesRaw = await Promise.all(recordings.map(async (record) => {
      const recordingId = String(record?.id || '').trim()
      const fileName = String(record?.file_name || '').trim()
      const ext = extname(fileName).toLowerCase()
      const sizeBytes = Number(record?.size_bytes) || 0
      const createdAt = parseTs(record?.created_at) || parseTs(record?.uploaded_at)
      const durationSec = Math.max(0, Number(record?.duration_sec) || 0)
      const latestNote = noteByRecordingId.get(recordingId) || noteByFileName.get(fileName) || null
      const latestMeetingJob = jobByRecordingId.get(recordingId) || jobByFileName.get(fileName) || null
      const urls = await resolveRecordingUrls(record, userConfig)
      return {
        id: recordingId,
        name: fileName,
        ext,
        size: sizeBytes,
        sizeFormatted: formatSize(sizeBytes),
        createdAt,
        category: getFileCategory(fileName),
        isTest: getFileCategory(fileName) === 'test',
        canConvertToMp3: ext === '.opus',
        isOpusLocked: ext === '.opus',
        durationSec,
        ossKey: String(record?.oss_key || ''),
        ossBucket: String(record?.oss_bucket || ''),
        ossUrl: urls.ossUrl,
        signedUrl: urls.signedUrl,
        downloadUrl: urls.downloadUrl,
        streamUrl: urls.streamUrl,
        latestNoteId: latestNote ? latestNote.noteId : '',
        latestNoteUrl: latestNote ? latestNote.noteUrl : '',
        latestNoteCreatedAt: latestNote ? latestNote.createdAt : 0,
        latestNoteTitle: latestNote ? String(latestNote.noteTitle || '') : '',
        latestMeetingJob
      }
    }))

    const files = filesRaw.filter(item => item.id && item.name)

    files.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))

    return Response.json({
      success: true,
      count: files.length,
      files,
    }, { headers: CORS_HEADERS })
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
    headers: CORS_HEADERS
  })
}
