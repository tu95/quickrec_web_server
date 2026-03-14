import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim()
const rawAllowedDevOrigins = String(
  process.env.NEXT_ALLOWED_DEV_ORIGINS ||
  '127.0.0.1,localhost'
).trim()
const appPublicOrigin = String(process.env.APP_PUBLIC_ORIGIN || '').trim()

function normalizeAllowedDevOrigin(value) {
  const input = String(value || '').trim()
  if (!input) return ''

  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
      return String(new URL(input).hostname || '').toLowerCase()
    }
  } catch {}

  const noProtocol = input.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  const hostWithMaybePath = noProtocol.split('/')[0] || ''
  const host = hostWithMaybePath.split(':')[0] || ''
  return String(host).toLowerCase()
}

function parseAllowedDevOrigins(raw) {
  if (!raw) return []
  const deduped = new Set()
  for (const item of raw.split(',')) {
    const normalized = normalizeAllowedDevOrigin(item)
    if (normalized) deduped.add(normalized)
  }
  return Array.from(deduped)
}

const allowedDevOrigins = parseAllowedDevOrigins(
  [rawAllowedDevOrigins, appPublicOrigin].filter(Boolean).join(',')
)

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: configuredDistDir || '.next',
  ...(allowedDevOrigins.length > 0
    ? { allowedDevOrigins }
    : {}),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: '*' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
