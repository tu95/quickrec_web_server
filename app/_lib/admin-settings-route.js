function normalizeToken(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const safe = text.replace(/[^a-zA-Z0-9_-]/g, '')
  if (safe.length < 8) return ''
  return safe.slice(0, 128)
}

export function getAdminSettingsToken() {
  return normalizeToken(process.env.ADMIN_SETTINGS_TOKEN)
}

export function getAdminSettingsPath() {
  const token = getAdminSettingsToken()
  if (!token) return '/settings'
  return `/settings/${token}`
}

export function isValidAdminSettingsToken(candidate) {
  const token = getAdminSettingsToken()
  if (!token) return false
  return String(candidate || '').trim() === token
}

