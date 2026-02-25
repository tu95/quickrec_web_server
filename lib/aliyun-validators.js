function trimText(value) {
  return String(value || '').trim()
}

function normalizeUrlHostLike(value) {
  const text = trimText(value)
  if (!text) return ''
  try {
    const parsed = text.includes('://') ? new URL(text) : new URL(`https://${text}`)
    return parsed.host.toLowerCase()
  } catch {
    return text.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  }
}

export function normalizeOssEndpoint(value) {
  return normalizeUrlHostLike(value)
}

export function normalizeOssPublicBaseUrl(value) {
  const text = trimText(value)
  if (!text) return ''
  try {
    const parsed = new URL(text)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return text.replace(/\/+$/, '')
  }
}

export function validateOssProvider(value) {
  const text = trimText(value)
  if (!text) return 'Provider 不能为空'
  if (text !== 'aliyun_oss') return 'Provider 必须是 aliyun_oss'
  return ''
}

export function validateOssEndpoint(value) {
  const host = normalizeOssEndpoint(value)
  if (!host) return 'Endpoint 不能为空'
  if (!/^[a-z0-9.-]+$/.test(host)) return 'Endpoint 格式错误'
  if (!/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(host)) {
    return 'Endpoint 必须类似 oss-cn-hangzhou.aliyuncs.com'
  }
  return ''
}

export function validateOssRegion(value) {
  const text = trimText(value).toLowerCase()
  if (!text) return 'Region 不能为空'
  if (!/^oss-[a-z0-9-]+$/.test(text)) return 'Region 格式错误，例如 oss-cn-hangzhou'
  return ''
}

export function validateOssBucket(value) {
  const text = trimText(value).toLowerCase()
  if (!text) return 'Bucket 不能为空'
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(text)) {
    return 'Bucket 格式错误，仅支持小写字母/数字/中划线，长度 3-63'
  }
  return ''
}

export function validateOssAccessKeyId(value) {
  const text = trimText(value)
  if (!text) return 'AccessKeyId 不能为空'
  if (!/^LTAI[0-9A-Za-z]{8,}$/.test(text)) return 'AccessKeyId 格式错误'
  return ''
}

export function validateOssAccessKeySecret(value) {
  const text = trimText(value)
  if (!text) return 'AccessKeySecret 不能为空'
  if (!/^[0-9A-Za-z_+=/.-]{16,128}$/.test(text)) return 'AccessKeySecret 格式错误'
  return ''
}

export function validateOssPublicBaseUrl(value, bucket, region) {
  const text = trimText(value)
  if (!text) return 'OSS Public Base URL 不能为空'
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return 'OSS Public Base URL 必须是有效 URL'
  }
  if (parsed.protocol !== 'https:') return 'OSS Public Base URL 必须使用 https'
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return 'OSS Public Base URL 不能包含路径、查询参数或 hash'
  }
  const host = parsed.host.toLowerCase()
  const bucketText = trimText(bucket).toLowerCase()
  const regionText = trimText(region).toLowerCase()
  if (bucketText && !host.startsWith(`${bucketText}.`)) {
    return 'OSS Public Base URL 必须以 <bucket>. 开头'
  }
  if (regionText && !host.includes(`.${regionText}.aliyuncs.com`)) {
    return 'OSS Public Base URL 与 Region 不匹配'
  }
  if (!/^[a-z0-9.-]+\.aliyuncs\.com$/.test(host)) {
    return 'OSS Public Base URL 域名格式错误'
  }
  return ''
}

export function validateOssObjectPrefix(value) {
  const text = trimText(value)
  if (!text) return 'OSS Object Prefix 不能为空'
  if (text.startsWith('/') || text.endsWith('/')) return 'OSS Object Prefix 不能以 / 开头或结尾'
  if (text.includes('//')) return 'OSS Object Prefix 不能包含连续 //'
  if (!/^[A-Za-z0-9._/-]+$/.test(text)) return 'OSS Object Prefix 仅支持字母数字._-/'
  return ''
}

export function validateOssConfig(input) {
  const oss = input && typeof input === 'object' ? input : {}
  const normalized = {
    provider: trimText(oss.provider),
    endpoint: normalizeOssEndpoint(oss.endpoint),
    region: trimText(oss.region).toLowerCase(),
    bucket: trimText(oss.bucket).toLowerCase(),
    accessKeyId: trimText(oss.accessKeyId),
    accessKeySecret: trimText(oss.accessKeySecret),
    publicBaseUrl: normalizeOssPublicBaseUrl(oss.publicBaseUrl),
    objectPrefix: trimText(oss.objectPrefix)
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
  const publicBaseError = validateOssPublicBaseUrl(
    normalized.publicBaseUrl,
    normalized.bucket,
    normalized.region
  )
  if (publicBaseError) errors.publicBaseUrl = publicBaseError
  const prefixError = validateOssObjectPrefix(normalized.objectPrefix)
  if (prefixError) errors.objectPrefix = prefixError

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized
  }
}

