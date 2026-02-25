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
