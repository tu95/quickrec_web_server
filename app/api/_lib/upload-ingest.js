import { promises as fs } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { enqueueMp3Convert } from './mp3-queue'
import { probeAudioDurationSec } from './audio-duration'
import { readConfigForUser } from './config-store'
import { uploadBufferToOss } from './oss-storage'
import { ensureDevice, insertRecordingMetadata } from './recorder-multiuser-store'

function safeFileName(name) {
  const value = basename(String(name || '').replace(/[\/\\]/g, '_')).trim()
  return value || `recording_${Date.now()}.opus`
}

function normalizeUserObjectTag(userId) {
  const raw = String(userId || '').trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (!raw) return 'u_unknown'
  return `u_${raw.slice(0, 16)}`
}

function buildObjectFileName(fileName, userId) {
  const safe = safeFileName(fileName)
  const userTag = normalizeUserObjectTag(userId)
  const random = Math.floor(Math.random() * 1000000)
  return `${userTag}_${Date.now()}_${random}_${safe}`
}

function buildWebDeviceIdentity(userId) {
  const safeUserId = String(userId || '').trim()
  return `web_uploader_${safeUserId}`
}

async function cleanupPaths(paths) {
  const list = Array.from(new Set((paths || []).filter(Boolean)))
  for (const path of list) {
    try {
      await fs.unlink(path)
    } catch {}
  }
}

export async function ingestUploadedLocalFile(input) {
  const source = input && typeof input === 'object' ? input : {}
  const userId = String(source.userId || '').trim()
  if (!userId) throw new Error('用户信息无效，请重新登录')

  const localFilePath = String(source.localFilePath || '').trim()
  if (!localFilePath) throw new Error('本地文件路径不能为空')

  let outputPath = localFilePath
  let outputFileName = safeFileName(source.fileName || basename(localFilePath))
  const cleanupList = [localFilePath]
  let autoConverted = false
  let convertedFileName = ''

  try {
    if (extname(outputFileName).toLowerCase() === '.opus') {
      const converted = await enqueueMp3Convert({
        uploadDir: dirname(localFilePath),
        opusFileName: outputFileName,
        overwrite: true,
        removeSource: true,
        source: String(source.source || 'upload-ingest')
      })
      autoConverted = true
      convertedFileName = String(converted?.filename || '').trim()
      if (!convertedFileName) throw new Error('Opus 转 MP3 失败：输出文件名为空')
      outputFileName = safeFileName(convertedFileName)
      outputPath = join(dirname(localFilePath), outputFileName)
      cleanupList.push(outputPath)
    }

    const fileBuffer = await fs.readFile(outputPath)
    if (!fileBuffer.length) throw new Error('上传文件为空')

    let durationSec = 0
    try {
      durationSec = await probeAudioDurationSec(outputPath)
    } catch {}

    const config = await readConfigForUser(userId)
    const objectFileName = buildObjectFileName(outputFileName, userId)
    const uploaded = await uploadBufferToOss(config, fileBuffer, objectFileName, {
      signedUrlExpiresSec: config?.aliyun?.oss?.asrSignedUrlExpiresSec
    })

    const webDevice = await ensureDevice(
      buildWebDeviceIdentity(userId),
      'web_upload',
      'web_server'
    )

    const recording = await insertRecordingMetadata({
      userId,
      deviceId: String(webDevice?.id || ''),
      fileName: outputFileName,
      ossKey: String(uploaded.objectKey || ''),
      ossUrl: uploaded.url || uploaded.signedUrl || '',
      ossBucket: String(uploaded.bucket || ''),
      sizeBytes: fileBuffer.length,
      durationSec,
      status: 'uploaded'
    })

    await cleanupPaths(cleanupList)

    return {
      recordingId: String(recording?.id || ''),
      outputFileName,
      autoConverted,
      convertedFileName,
      sizeBytes: fileBuffer.length,
      durationSec,
      ossKey: String(uploaded.objectKey || ''),
      ossUrl: uploaded.url || uploaded.signedUrl || '',
      signedUrl: String(uploaded.signedUrl || '')
    }
  } catch (error) {
    await cleanupPaths(cleanupList)
    throw error
  }
}
