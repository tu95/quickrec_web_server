import { promises as fs } from 'fs'
import { join } from 'path'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const PENDING_FILE = join(UPLOAD_DIR, '.pending-jobs.json')

// 持久化待上传任务，服务重启后可恢复
async function readStore() {
  try {
    const raw = await fs.readFile(PENDING_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && typeof data.jobs === 'object') {
      return data.jobs
    }
  } catch {}
  return {}
}

async function writeStore(jobs) {
  const data = { updatedAt: Date.now(), jobs: jobs || {} }
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const tmp = `${PENDING_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, PENDING_FILE)
}

export async function savePendingJob(job) {
  const store = await readStore()
  store[String(job.id)] = {
    id: String(job.id || ''),
    uploadId: String(job.uploadId || ''),
    userId: String(job.userId || ''),
    deviceDbId: String(job.deviceDbId || ''),
    deviceIdentity: String(job.deviceIdentity || ''),
    localFileName: String(job.localFileName || ''),
    queuedAt: Number(job.queuedAt || Date.now()),
    attempt: Number(job.attempt || 0),
    maxRetries: Number(job.maxRetries || 3),
    error: String(job.error || ''),
    status: String(job.status || 'queued')
  }
  await writeStore(store)
}

export async function removePendingJob(jobId) {
  const store = await readStore()
  delete store[String(jobId)]
  await writeStore(store)
}

export async function loadPendingJobs() {
  const store = await readStore()
  return Object.values(store).filter(
    j => j && j.status !== 'success'
  )
}
