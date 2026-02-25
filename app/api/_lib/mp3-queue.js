import { randomUUID } from 'crypto'
import PQueue from 'p-queue'
import { convertOpusFileToMp3 } from './opus-mp3'

const queue = new PQueue({
  concurrency: 1
})

const MAX_RECENT_JOBS = 50
const recentJobs = []

function pushRecentJob(job) {
  recentJobs.push(job)
  if (recentJobs.length > MAX_RECENT_JOBS) {
    recentJobs.splice(0, recentJobs.length - MAX_RECENT_JOBS)
  }
}

export function getMp3QueueState() {
  return {
    pending: queue.pending,
    queued: queue.size,
    recentJobs: [...recentJobs]
  }
}

export async function enqueueMp3Convert(options) {
  const createdAt = Date.now()
  const jobId = randomUUID()
  const opusFileName = String(options?.opusFileName || '')
  const source = String(options?.source || 'unknown')
  const queuedAhead = queue.pending + queue.size

  console.log('[mp3-queue] queued', {
    jobId,
    source,
    opusFileName,
    queuedAhead
  })

  return queue.add(async () => {
    const startedAt = Date.now()
    console.log('[mp3-queue] started', {
      jobId,
      source,
      opusFileName,
      waitMs: startedAt - createdAt
    })

    try {
      const converted = await convertOpusFileToMp3(options)
      const finishedAt = Date.now()
      const queueMeta = {
        jobId,
        source,
        queuedAhead,
        createdAt,
        startedAt,
        finishedAt,
        waitMs: startedAt - createdAt,
        runMs: finishedAt - startedAt
      }

      pushRecentJob({
        ...queueMeta,
        status: 'success',
        opusFileName,
        outputFileName: converted.filename
      })

      console.log('[mp3-queue] finished', {
        jobId,
        source,
        opusFileName,
        outputFileName: converted.filename,
        runMs: queueMeta.runMs
      })

      return {
        ...converted,
        queueMeta
      }
    } catch (error) {
      const finishedAt = Date.now()
      const message = String(error && error.message ? error.message : error)

      pushRecentJob({
        jobId,
        source,
        status: 'failed',
        opusFileName,
        createdAt,
        startedAt,
        finishedAt,
        waitMs: startedAt - createdAt,
        runMs: finishedAt - startedAt,
        error: message
      })

      console.error('[mp3-queue] failed', {
        jobId,
        source,
        opusFileName,
        error: message
      })
      throw error
    }
  })
}
