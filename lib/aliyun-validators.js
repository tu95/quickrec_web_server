function trimText(value) {
  return String(value || '').trim()
}

function parseMaybeUrl(value) {
  const text = trimText(value)
  if (!text) return null
  try {
    if (text.includes('://')) return new URL(text)
    return new URL(`https://${text}`)
  } catch {
    return null
  }
}

function parseEndpoint(value) {
  const text = trimText(value)
  if (!text) {
    return {
      host: '',
      pathname: '',
      bucketFromPath: ''
    }
  }

  const parsed = parseMaybeUrl(text)
  if (parsed) {
    const pathname = String(parsed.pathname || '').trim()
    const firstSeg = pathname
      .split('/')
      .map(item => item.trim())
      .filter(Boolean)[0] || ''
    return {
      host: String(parsed.host || '').toLowerCase(),
      pathname,
      bucketFromPath: firstSeg.toLowerCase()
    }
  }

  const fallback = text
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  return {
    host: fallback,
    pathname: '',
    bucketFromPath: ''
  }
}

export function normalizeOssEndpoint(value) {
  return parseEndpoint(value).host
}

export function normalizeOssPublicBaseUrl(value) {
  const text = trimText(value)
  if (!text) return ''
  const parsed = parseMaybeUrl(text)
  if (parsed) {
    const pathname = String(parsed.pathname || '').replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${pathname}`
  }
  return text.replace(/\/+$/, '')
}

const S3_PROVIDER_ALLOWLIST = new Set([
  's3_compatible',
  'cloudflare_r2',
  'aliyun_oss',
  'aws_s3'
])

export function validateOssProvider(value) {
  const text = trimText(value)
  if (!text) return 'Provider 不能为空'
  if (!S3_PROVIDER_ALLOWLIST.has(text)) {
    return 'Provider 必须是 s3_compatible / cloudflare_r2 / aliyun_oss / aws_s3'
  }
  return ''
}

export function validateOssEndpoint(value) {
  const host = normalizeOssEndpoint(value)
  if (!host) return 'Endpoint 不能为空'
  if (!/^[a-z0-9.-]+$/.test(host)) return 'Endpoint 格式错误'
  return ''
}

export function validateOssRegion(value) {
  const text = trimText(value).toLowerCase()
  if (!text) return 'Region 不能为空'
  if (!/^[a-z0-9][a-z0-9-_]{0,62}$/.test(text)) {
    return 'Region 格式错误，例如 auto / us-east-1 / oss-cn-hangzhou'
  }
  return ''
}

export function validateOssBucket(value) {
  const text = trimText(value).toLowerCase()
  if (!text) return 'Bucket 不能为空'
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(text)) {
    return 'Bucket 格式错误，仅支持小写字母/数字/点/中划线，长度 3-63'
  }
  if (text.includes('..')) return 'Bucket 格式错误，不能包含连续 ..'
  return ''
}

export function validateOssAccessKeyId(value) {
  const text = trimText(value)
  if (!text) return 'AccessKeyId 不能为空'
  if (!/^[0-9A-Za-z+=,.@_-]{8,128}$/.test(text)) return 'AccessKeyId 格式错误'
  return ''
}

export function validateOssAccessKeySecret(value) {
  const text = trimText(value)
  if (!text) return 'AccessKeySecret 不能为空'
  if (!/^[0-9A-Za-z_+=/.,:@\-!$%^&*()]{8,256}$/.test(text)) return 'AccessKeySecret 格式错误'
  return ''
}

export function validateOssPublicBaseUrl(value) {
  const text = trimText(value)
  if (!text) return ''
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return 'Public Base URL 必须是有效 URL'
  }
  if (parsed.protocol !== 'https:') return 'Public Base URL 必须使用 https'
  if (parsed.search || parsed.hash) {
    return 'Public Base URL 不能包含查询参数或 hash'
  }
  return ''
}

export function validateOssObjectPrefix(value) {
  const text = trimText(value)
  if (!text) return 'Object Prefix 不能为空'
  if (text.startsWith('/') || text.endsWith('/')) return 'Object Prefix 不能以 / 开头或结尾'
  if (text.includes('//')) return 'Object Prefix 不能包含连续 //'
  if (!/^[A-Za-z0-9._/-]+$/.test(text)) return 'Object Prefix 仅支持字母数字._-/'
  return ''
}

export function validateOssConfig(input) {
  const oss = input && typeof input === 'object' ? input : {}
  const endpointMeta = parseEndpoint(oss.endpoint)
  const objectPrefixMp3 = trimText(oss.objectPrefixMp3) || 'recordings/mp3'
  const objectPrefixOpus = trimText(oss.objectPrefixOpus) || 'recordings/opus'

  const normalized = {
    provider: trimText(oss.provider) || 's3_compatible',
    endpoint: endpointMeta.host,
    region: trimText(oss.region).toLowerCase(),
    bucket: (trimText(oss.bucket) || endpointMeta.bucketFromPath).toLowerCase(),
    accessKeyId: trimText(oss.accessKeyId),
    accessKeySecret: trimText(oss.accessKeySecret),
    publicBaseUrl: normalizeOssPublicBaseUrl(oss.publicBaseUrl),
    objectPrefixMp3,
    objectPrefixOpus
  }

  const errors = {}
  const providerError = validateOssProvider(normalized.provider)
  if (providerError) errors.provider = providerError
  const endpointError = validateOssEndpoint(normalized.endpoint)
  if (endpointError) errors.endpoint = endpointError
  const regionError = validateOssRegion(normalized.region)
  if (regionError) errors.region = regionError
  const bucketError = validateOssBucket(normalized.bucket)
  if (bucketError) errors.bucket = bucketError
  const keyIdError = validateOssAccessKeyId(normalized.accessKeyId)
  if (keyIdError) errors.accessKeyId = keyIdError
  const keySecretError = validateOssAccessKeySecret(normalized.accessKeySecret)
  if (keySecretError) errors.accessKeySecret = keySecretError
  const publicBaseError = validateOssPublicBaseUrl(normalized.publicBaseUrl)
  if (publicBaseError) errors.publicBaseUrl = publicBaseError
  const prefixMp3Error = validateOssObjectPrefix(normalized.objectPrefixMp3)
  if (prefixMp3Error) errors.objectPrefixMp3 = prefixMp3Error
  const prefixOpusError = validateOssObjectPrefix(normalized.objectPrefixOpus)
  if (prefixOpusError) errors.objectPrefixOpus = prefixOpusError

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized
  }
}
