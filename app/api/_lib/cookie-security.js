function readEnv(name) {
  return String(process.env[name] || '').trim()
}

function parseBool(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return null
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false
  return null
}

export function shouldUseSecureCookies() {
  const forced = parseBool(readEnv('COOKIE_SECURE'))
  if (forced !== null) return forced
  const origin = readEnv('APP_PUBLIC_ORIGIN')
  return /^https:\/\//i.test(origin)
}

export function getCookieSecureSuffix() {
  return shouldUseSecureCookies() ? '; Secure' : ''
}

