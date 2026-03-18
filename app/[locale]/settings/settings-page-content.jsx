import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
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
  const t = await getTranslations('settings')
  return (
    <main className="page-root">
      <section className="panel panel-dark mb-3 rounded-2xl border border-white/10 bg-gradient-to-b from-[#161321eb] to-[#110f1ce8] p-4 shadow-[0_18px_42px_rgba(5,4,11,0.38)]">
        <h1 className="m-0 text-[28px] leading-[1.2] font-extrabold text-violet-50">{t('title')}</h1>
        <p className="muted mt-2.5 mb-0 text-sm text-white/70">
          {t('description')}
        </p>
      </section>
      <section className="panel panel-dark rounded-2xl border border-white/10 bg-gradient-to-b from-[#161321eb] to-[#110f1ce8] p-3 shadow-[0_18px_42px_rgba(5,4,11,0.38)]">
        <SettingsClient cacheUserId={cacheUserId} />
      </section>
    </main>
  )
}
