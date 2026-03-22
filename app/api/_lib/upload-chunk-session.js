import { promises as fs } from 'fs'
import { join } from 'path'

const uploadSessionMap = new Map()

// 同一 sessionKey 上串行执行，避免并发双写 append / index=0 误清会话。
const chunkExclusiveChains = new Map()

// 这个函数主要是把同一 upload 会话上的处理排队，消灭竞态。
export function runChunkSessionExclusive(sessionKey, fn) {
  const key = String(sessionKey || '')
  const prev = chunkExclusiveChains.get(key) || Promise.resolve()
  const job = prev.catch(() => {}).then(() => fn())
  let tail = null
  tail = job.finally(() => {
    if (chunkExclusiveChains.get(key) === tail) {
      chunkExclusiveChains.delete(key)
    }
  })
  chunkExclusiveChains.set(key, tail)
  return job
}

// 这个函数主要是生成统一的分片会话 key。
export function buildUploadSessionKey(userId, uploadId, scope = 'default') {
  const uid = String(userId || '').trim()
  const upid = String(uploadId || '').trim()
  const tag = String(scope || 'default').trim()
  return `${tag}:${uid}:${upid}`
}

// 这个函数主要是把会话 key 转成安全的临时文件名。
export function toPartFileNameFromSessionKey(sessionKey) {
  const safe = String(sessionKey || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safe}.part`
}

// 这个函数主要是按统一规则生成分片临时文件路径。
export function buildUploadSessionPartPath(tmpDir, sessionKey) {
  return join(String(tmpDir || ''), toPartFileNameFromSessionKey(sessionKey))
}

// 这个函数主要是读取内存里的分片会话。
export function getUploadSession(sessionKey) {
  return uploadSessionMap.get(String(sessionKey || '')) || null
}

// 这个函数主要是写回内存里的分片会话。
export function setUploadSession(sessionKey, session) {
  uploadSessionMap.set(String(sessionKey || ''), session)
  return session
}

// 这个函数主要是删掉内存里的分片会话。
export function deleteUploadSession(sessionKey) {
  uploadSessionMap.delete(String(sessionKey || ''))
}

// 这个函数主要是清理单个临时分片文件。
export async function cleanupTmpPart(filePath) {
  try {
    await fs.unlink(filePath)
  } catch {}
}

// 这个函数主要是按超时规则清理旧分片会话和临时文件。
export async function cleanupStaleUploadSessions(staleMs) {
  const ttlMs = Number(staleMs) || 0
  const now = Date.now()
  for (const [key, session] of uploadSessionMap.entries()) {
    const ts = Number(session?.updatedAt) || 0
    if (!ts || (ttlMs > 0 && (now - ts) > ttlMs)) {
      uploadSessionMap.delete(key)
      const partPath = String(session?.partPath || '')
      if (partPath) {
        await cleanupTmpPart(partPath)
      }
    }
  }
}
