import { createReadStream } from 'fs'
import { basename } from 'path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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

function normalizeEndpointUrl(host) {
  const text = String(host || '').trim().replace(/^https?:\/\//i, '')
  if (!text) return ''
  return `https://${text}`
}

function createS3ClientFromConfig(config) {
  const ossConfig = config?.aliyun?.oss || {}
  const validation = validateOssConfig(ossConfig)
  if (!validation.valid) {
    const detail = pickFirstError(validation.errors)
    throw new Error(detail ? `对象存储配置无效: ${detail}` : '对象存储配置无效')
  }

  const normalized = validation.normalized
  const endpoint = normalizeEndpointUrl(normalized.endpoint)
  const region = String(normalized.region || '').trim() || 'auto'

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: normalized.accessKeyId,
      secretAccessKey: normalized.accessKeySecret
    }
  })

  return {
    client,
    normalized
  }
}

function withBucketOverride(config, bucketOverride) {
  const bucket = String(bucketOverride || '').trim()
  if (!bucket) return config
  return {
    ...(config && typeof config === 'object' ? config : {}),
    aliyun: {
      ...((config && typeof config.aliyun === 'object') ? config.aliyun : {}),
      oss: {
        ...((config?.aliyun && typeof config.aliyun.oss === 'object') ? config.aliyun.oss : {}),
        bucket
      }
    }
  }
}

function normalizeObjectKey(rawKey) {
  const key = trimSlash(String(rawKey || ''))
  if (!key) return ''
  if (key === '.' || key === '..') return ''
  return key
}

function pickObjectPrefix(normalized, safeFileName) {
  const lowerName = String(safeFileName || '').toLowerCase()
  const isOpus = lowerName.endsWith('.opus')
  const rawPrefix = isOpus ? normalized.objectPrefixOpus : normalized.objectPrefixMp3
  return trimSlash(rawPrefix)
}

function buildPublicUrl(publicBaseUrl, objectKey) {
  const base = String(publicBaseUrl || '').replace(/\/+$/, '')
  if (!base) return ''
  return `${base}/${encodePath(objectKey)}`
}

async function signGetUrl(client, bucket, key, expiresSec, options) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(options?.forceAttachment
      ? {
          ResponseContentDisposition: `attachment; filename="${String(options.downloadFileName || 'recording').replace(/[\r\n"]/g, '_')}"`
        }
      : {})
  })
  return getSignedUrl(client, command, { expiresIn: expiresSec })
}

async function ensureObjectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    const text = String(error?.name || error?.Code || error?.message || '').toLowerCase()
    const status = Number(error?.$metadata?.httpStatusCode || 0)
    if (status === 404 || text.includes('nosuchkey') || text.includes('notfound')) {
      return false
    }
    throw error
  }
}

async function readBodyToBuffer(body) {
  if (!body) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray()
    return Buffer.from(bytes)
  }
  if (typeof body.arrayBuffer === 'function') {
    const ab = await body.arrayBuffer()
    return Buffer.from(ab)
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = []
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  throw new Error('对象存储读取失败: 不支持的响应体类型')
}

export async function uploadLocalFileToOss(config, localFilePath, objectFileName, options) {
  const safeFileName = basename(String(objectFileName || ''))
  if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
    throw new Error('对象存储上传失败: 无效文件名')
  }

  const { client, normalized } = createS3ClientFromConfig(config)
  const prefix = pickObjectPrefix(normalized, safeFileName)
  const objectKey = prefix ? `${prefix}/${safeFileName}` : safeFileName

  await client.send(new PutObjectCommand({
    Bucket: normalized.bucket,
    Key: objectKey,
    Body: createReadStream(localFilePath)
  }))

  const signedUrlExpiresSec = toSignedUrlExpiresSec(options?.signedUrlExpiresSec)
  let signedUrl = ''
  try {
    signedUrl = await signGetUrl(client, normalized.bucket, objectKey, signedUrlExpiresSec)
  } catch (error) {
    throw new Error(`对象存储签名链接生成失败: ${String(error && error.message ? error.message : error)}`)
  }

  const publicUrl = buildPublicUrl(normalized.publicBaseUrl, objectKey)

  return {
    objectKey,
    url: signedUrl,
    signedUrl,
    signedUrlExpiresSec,
    bucket: normalized.bucket,
    publicUrl
  }
}

export async function uploadBufferToOss(config, buffer, objectFileName, options) {
  const safeFileName = basename(String(objectFileName || ''))
  if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
    throw new Error('对象存储上传失败: 无效文件名')
  }
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    throw new Error('对象存储上传失败: 空文件内容')
  }

  const { client, normalized } = createS3ClientFromConfig(config)
  const prefix = pickObjectPrefix(normalized, safeFileName)
  const objectKey = prefix ? `${prefix}/${safeFileName}` : safeFileName

  await client.send(new PutObjectCommand({
    Bucket: normalized.bucket,
    Key: objectKey,
    Body: buffer
  }))

  const signedUrlExpiresSec = toSignedUrlExpiresSec(options?.signedUrlExpiresSec)
  let signedUrl = ''
  try {
    signedUrl = await signGetUrl(client, normalized.bucket, objectKey, signedUrlExpiresSec)
  } catch (error) {
    throw new Error(`对象存储签名链接生成失败: ${String(error && error.message ? error.message : error)}`)
  }

  const publicUrl = buildPublicUrl(normalized.publicBaseUrl, objectKey)

  return {
    objectKey,
    url: signedUrl,
    signedUrl,
    signedUrlExpiresSec,
    bucket: normalized.bucket,
    publicUrl
  }
}

export async function signOssObjectUrl(config, objectKey, options) {
  const key = normalizeObjectKey(objectKey)
  if (!key) {
    throw new Error('对象存储签名失败: objectKey 不能为空')
  }
  const effectiveConfig = withBucketOverride(config, options?.ossBucket)
  const { client, normalized } = createS3ClientFromConfig(effectiveConfig)
  const signedUrlExpiresSec = toSignedUrlExpiresSec(options?.signedUrlExpiresSec)

  const signedUrl = await signGetUrl(client, normalized.bucket, key, signedUrlExpiresSec, {
    forceAttachment: options?.forceAttachment === true,
    downloadFileName: options?.downloadFileName
  })

  const publicUrl = buildPublicUrl(normalized.publicBaseUrl, key)

  return {
    objectKey: key,
    signedUrl: String(signedUrl || ''),
    url: publicUrl,
    signedUrlExpiresSec
  }
}

export async function deleteOssObject(config, objectKey, options) {
  const key = normalizeObjectKey(objectKey)
  if (!key) return { deleted: false, skipped: true }
  const bucketOverride = options?.ossBucket
  const effectiveConfig = withBucketOverride(config, bucketOverride)
  const { client, normalized } = createS3ClientFromConfig(effectiveConfig)

  const exists = await ensureObjectExists(client, normalized.bucket, key)
  if (!exists) {
    return { deleted: false, skipped: false, notFound: true }
  }

  await client.send(new DeleteObjectCommand({ Bucket: normalized.bucket, Key: key }))
  return { deleted: true, skipped: false }
}

export async function getOssObject(config, objectKey, options) {
  const key = normalizeObjectKey(objectKey)
  if (!key) {
    throw new Error('对象存储获取失败: objectKey 不能为空')
  }
  const bucketOverride = options?.ossBucket
  const effectiveConfig = withBucketOverride(config, bucketOverride)
  const { client, normalized } = createS3ClientFromConfig(effectiveConfig)

  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: normalized.bucket,
      Key: key
    }))

    const content = await readBodyToBuffer(result.Body)
    return {
      content,
      contentType: result.ContentType || 'application/octet-stream',
      contentLength: Number(result.ContentLength || content.length || 0),
      objectKey: key,
      bucket: normalized.bucket
    }
  } catch (error) {
    const text = String(error?.name || error?.Code || error?.message || '').toLowerCase()
    const status = Number(error?.$metadata?.httpStatusCode || 0)
    if (status === 404 || text.includes('nosuchkey') || text.includes('notfound')) {
      return null
    }
    throw error
  }
}
