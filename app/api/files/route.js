import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { requireSiteAuth } from '../_lib/admin-auth'
import {
  createSupabaseServiceClient,
  getSupabaseServiceConfigError
} from '../_lib/supabase-client'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const NOTES_DIR = join(UPLOAD_DIR, 'meeting_notes')
const JOBS_DIR = join(NOTES_DIR, 'jobs')
const RECORDINGS_TABLE = 'recorder_recordings'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
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

function toClientMeetingJob(rawJob) {
  if (!rawJob || typeof rawJob !== 'object') return null
  const id = String(rawJob.id || '').trim()
  const fileName = String(rawJob.fileName || '').trim()
  if (!id || !fileName) return null
  return {
    id,
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

async function loadLatestNoteMap() {
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

      const sourceFileName = String(metadata?.fileName || '').trim()
      if (!sourceFileName) continue
      const noteId = String(metadata?.id || entry.name.slice(0, -5)).trim()
      if (!noteId) continue
      const createdAt = toNumber(metadata?.createdAt)
      const previous = byFileName.get(sourceFileName)
      if (!previous || createdAt >= previous.createdAt) {
        const noteTitle = String(metadata?.noteTitle || '').trim()
        byFileName.set(sourceFileName, {
          noteId,
          noteUrl: `/notes/${encodeURIComponent(noteId)}`,
          createdAt,
          noteTitle
        })
      }
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return byFileName
    }
    throw error
  }
  return byFileName
}

async function loadLatestMeetingJobMap() {
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

      const job = toClientMeetingJob(rawJob)
      if (!job) continue
      const fileName = job.fileName
      const jobOrderTs = job.updatedAt || job.createdAt
      const previous = byFileName.get(fileName)
      if (!previous) {
        byFileName.set(fileName, job)
        continue
      }
      const prevOrderTs = toNumber(previous.updatedAt) || toNumber(previous.createdAt)
      if (jobOrderTs >= prevOrderTs) {
        byFileName.set(fileName, job)
      }
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return byFileName
    }
    throw error
  }
  return byFileName
}

function parseTs(value) {
  const ts = new Date(String(value || '')).getTime()
  if (!Number.isFinite(ts) || ts <= 0) return 0
  return ts
}

async function loadLatestDurationMap(fileNames) {
  const result = new Map()
  const list = Array.from(new Set(
    (Array.isArray(fileNames) ? fileNames : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ))
  if (list.length === 0) return result
  if (getSupabaseServiceConfigError()) return result

  try {
    const client = createSupabaseServiceClient()
    const batchSize = 200
    const latestByName = new Map()
    for (let i = 0; i < list.length; i += batchSize) {
      const chunk = list.slice(i, i + batchSize)
      const { data, error } = await client
        .from(RECORDINGS_TABLE)
        .select('file_name,duration_sec,uploaded_at,created_at')
        .in('file_name', chunk)

      if (error) {
        throw new Error(String(error.message || '读取录音时长失败'))
      }

      for (const row of Array.isArray(data) ? data : []) {
        const fileName = String(row?.file_name || '').trim()
        if (!fileName) continue
        const ts = parseTs(row?.uploaded_at) || parseTs(row?.created_at)
        const durationSec = Math.max(0, Number(row?.duration_sec) || 0)
        const prev = latestByName.get(fileName)
        if (!prev || ts >= prev.ts) {
          latestByName.set(fileName, { ts, durationSec })
        }
      }
    }
    for (const [fileName, value] of latestByName.entries()) {
      result.set(fileName, Number(value?.durationSec) || 0)
    }
    return result
  } catch (error) {
    console.warn('[files] load duration map failed:', String(error?.message || error))
    return result
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
    await ensureUploadDir()
    const files = await fs.readdir(UPLOAD_DIR)
    const visibleFiles = files.filter(name => !name.startsWith('.'))
    const latestNoteMap = await loadLatestNoteMap()
    const latestMeetingJobMap = await loadLatestMeetingJobMap()
    const latestDurationMap = await loadLatestDurationMap(visibleFiles)

    const fileList = await Promise.all(
      visibleFiles
        .map(async (name) => {
          const stat = await fs.stat(join(UPLOAD_DIR, name))
          if (!stat.isFile()) return null
          const ext = extname(name).toLowerCase()
          const latestNote = latestNoteMap.get(name) || null
          const latestMeetingJob = latestMeetingJobMap.get(name) || null
          return {
            name,
            ext,
            size: stat.size,
            sizeFormatted: formatSize(stat.size),
            createdAt: stat.birthtime.getTime(),
            category: getFileCategory(name),
            isTest: getFileCategory(name) === 'test',
            canConvertToMp3: ext === '.opus',
            isOpusLocked: ext === '.opus',
            latestNoteId: latestNote ? latestNote.noteId : '',
            latestNoteUrl: latestNote ? latestNote.noteUrl : '',
            latestNoteCreatedAt: latestNote ? latestNote.createdAt : 0,
            latestNoteTitle: latestNote ? String(latestNote.noteTitle || '') : '',
            durationSec: Number(latestDurationMap.get(name) || 0),
            latestMeetingJob
          }
        })
    )

    const compactedFileList = fileList.filter(Boolean)
    compactedFileList.sort((a, b) => b.createdAt - a.createdAt)

    return Response.json({
      success: true,
      count: compactedFileList.length,
      files: compactedFileList,
    }, { headers: CORS_HEADERS })
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
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
