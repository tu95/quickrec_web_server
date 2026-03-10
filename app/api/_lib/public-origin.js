const DEFAULT_LOCAL_ORIGIN = 'http://localhost:3000'

function readEnv(name) {
  return String(process.env[name] || '').trim()
}

function normalizeOrigin(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  try {
    const parsed = new URL(text)
    const protocol = String(parsed.protocol || '').toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') return ''
    return `${protocol}//${parsed.host}`
  } catch {
    return ''
  }
}

export function getPublicOrigin() {
  const fromEnv = normalizeOrigin(readEnv('APP_PUBLIC_ORIGIN'))
  return fromEnv || DEFAULT_LOCAL_ORIGIN
}

export function buildPublicUrl(path) {
  const origin = getPublicOrigin()
  const text = String(path || '').trim()
  if (!text) return origin
  if (/^https?:\/\//i.test(text)) return text
  const normalizedPath = text.startsWith('/') ? text : `/${text}`
  return `${origin}${normalizedPath}`
}

