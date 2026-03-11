import { headers } from 'next/headers'
import SettingsClient from './settings-client'

function decodeJwtPayload(token) {
  const text = String(token || '').trim()
  const parts = text.split('.')
  if (parts.length < 2) return null
  const payload = String(parts[1] || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function readCookieValue(cookieHeader, name) {
  const safeName = String(name || '').trim()
  if (!safeName) return ''
  const source = String(cookieHeader || '')
  if (!source) return ''
  const escaped = safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))
  if (!match) return ''
  try {
    return decodeURIComponent(String(match[1] || ''))
  } catch {
    return String(match[1] || '')
  }
}

function getUserIdFromAccessTokenCookie(headerStore) {
  const cookieHeader = headerStore.get('cookie') || ''
  const accessToken = readCookieValue(cookieHeader, 'zr_user_access_token')
  if (!accessToken) return ''
  const payload = decodeJwtPayload(accessToken)
  return String(payload?.sub || payload?.user_id || '').trim()
}

export default async function SettingsPageContent() {
  const headerStore = await headers()
  const cacheUserId = getUserIdFromAccessTokenCookie(headerStore)
  return (
    <main className="page-root">
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>会议纪要设置中心</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          管理访问密钥、LLM 提供商、模型、Prompt 与语音识别参数。
        </p>
      </section>
      <section className="panel panel-dark">
        <SettingsClient cacheUserId={cacheUserId} />
      </section>
    </main>
  )
}

