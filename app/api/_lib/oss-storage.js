import OSS from 'ali-oss'
import { basename } from 'path'
import { validateOssConfig } from '../../../lib/aliyun-validators'

function trimSlash(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '')
}

function encodePath(path) {
  return String(path || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
}

function toSignedUrlExpiresSec(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 21600
  const rounded = Math.floor(parsed)
  if (rounded < 60) return 60
  if (rounded > 172800) return 172800
  return rounded
}

function pickFirstError(errors) {
  const entries = Object.entries(errors || {})
  if (entries.length === 0) return ''
  const [field, message] = entries[0]
  return `${field}: ${String(message || '')}`.trim()
}

function createOssClientFromConfig(config) {
  const ossConfig = config?.aliyun?.oss || {}
  const validation = validateOssConfig(ossConfig)
  if (!validation.valid) {
    const detail = pickFirstError(validation.errors)
    throw new Error(detail ? `OSS 配置无效: ${detail}` : 'OSS 配置无效')
  }

  const normalized = validation.normalized
  const client = new OSS({
    region: normalized.region,
    bucket: normalized.bucket,
    endpoint: normalized.endpoint || undefined,
    accessKeyId: normalized.accessKeyId,
    accessKeySecret: normalized.accessKeySecret,
    secure: true
  })
  return {
    client,
    normalized
  }
}

function normalizeObjectKey(rawKey) {
  const key = trimSlash(String(rawKey || ''))
  if (!key) return ''
  if (key === '.' || key === '..') return ''
  return key
}

export async function uploadLocalFileToOss(config, localFilePath, objectFileName, options) {
  const safeFileName = basename(String(objectFileName || ''))
  if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
    throw new Error('OSS 上传失败: 无效文件名')
  }

  const { client, normalized } = createOssClientFromConfig(config)
  const prefix = trimSlash(normalized.objectPrefix)
  const objectKey = prefix ? `${prefix}/${safeFileName}` : safeFileName
  await client.put(objectKey, localFilePath)

  const signedUrlExpiresSec = toSignedUrlExpiresSec(options?.signedUrlExpiresSec)
  let signedUrl = ''
  try {
    signedUrl = client.signatureUrl(objectKey, {
      method: 'GET',
      expires: signedUrlExpiresSec
    })
  } catch (error) {
    throw new Error(`OSS 签名链接生成失败: ${String(error && error.message ? error.message : error)}`)
  }

  const publicBaseUrl = String(normalized.publicBaseUrl || '').replace(/\/+$/, '')
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl}/${encodePath(objectKey)}`
    : ''

  return {
    objectKey,
    url: publicUrl,
    signedUrl,
    signedUrlExpiresSec,
    bucket: normalized.bucket
  }
}

export async function uploadBufferToOss(config, buffer, objectFileName, options) {
  const safeFileName = basename(String(objectFileName || ''))
  if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
    throw new Error('OSS 上传失败: 无效文件名')
  }
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    throw new Error('OSS 上传失败: 空文件内容')
  }

  const { client, normalized } = createOssClientFromConfig(config)
  const prefix = trimSlash(normalized.objectPrefix)
  const objectKey = prefix ? `${prefix}/${safeFileName}` : safeFileName
  await client.put(objectKey, buffer)

  const signedUrlExpiresSec = toSignedUrlExpiresSec(options?.signedUrlExpiresSec)
  let signedUrl = ''
  try {
    signedUrl = client.signatureUrl(objectKey, {
      method: 'GET',
      expires: signedUrlExpiresSec
    })
  } catch (error) {
    throw new Error(`OSS 签名链接生成失败: ${String(error && error.message ? error.message : error)}`)
  }

  const publicBaseUrl = String(normalized.publicBaseUrl || '').replace(/\/+$/, '')
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl}/${encodePath(objectKey)}`
    : ''

  return {
    objectKey,
    url: publicUrl,
    signedUrl,
    signedUrlExpiresSec,
    bucket: normalized.bucket
  }
}

export function signOssObjectUrl(config, objectKey, options) {
  const key = normalizeObjectKey(objectKey)
  if (!key) {
    throw new Error('OSS 签名失败: objectKey 不能为空')
  }
  const { client, normalized } = createOssClientFromConfig(config)
  const signedUrlExpiresSec = toSignedUrlExpiresSec(options?.signedUrlExpiresSec)
  const signedUrl = client.signatureUrl(key, {
    method: 'GET',
    expires: signedUrlExpiresSec
  })

  const publicBaseUrl = String(normalized.publicBaseUrl || '').replace(/\/+$/, '')
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl}/${encodePath(key)}`
    : ''

  return {
    objectKey: key,
    signedUrl: String(signedUrl || ''),
    url: publicUrl,
    signedUrlExpiresSec
  }
}

export async function deleteOssObject(config, objectKey) {
  const key = normalizeObjectKey(objectKey)
  if (!key) return { deleted: false, skipped: true }
  const { client } = createOssClientFromConfig(config)
  try {
    await client.delete(key)
    return { deleted: true, skipped: false }
  } catch (error) {
    const text = String(error?.message || error || '')
    if (text.toLowerCase().includes('nosuchkey') || text.toLowerCase().includes('not found')) {
      return { deleted: false, skipped: false, notFound: true }
    }
    throw error
  }
}
