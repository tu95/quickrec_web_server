'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, usePathname, useRouter } from '../i18n/navigation'
import { clearCurrentUserApiCaches } from './_lib/client-cache'

export default function HomeAuthActions() {
  const [busy, setBusy] = useState(false)
  const pathname = usePathname()
  const locale = useLocale()
  const router = useRouter()
  const t = useTranslations('common.nav')

  function linkClass(target, extra = '') {
    const active = pathname === target
    return ['top-nav-link', active ? 'top-nav-link-active' : '', extra].filter(Boolean).join(' ')
  }

  function switchLocale() {
    const next = locale === 'zh' ? 'en' : 'zh'
    router.replace(pathname, { locale: next })
  }

  async function logout() {
    setBusy(true)
    try {
      const res = await fetch('/api/user-auth/logout', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      clearCurrentUserApiCaches()
      if (typeof window !== 'undefined') {
        window.location.href = locale === 'zh' ? '/login' : `/${locale}/login`
      }
    } catch (error) {
      clearCurrentUserApiCaches()
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(String(error?.message || error))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <nav className="top-nav-shell" aria-label={locale === 'zh' ? '快速导航' : 'Quick Navigation'}>
      <div className="top-nav-main">
        <Link href="/" className={linkClass('/')} aria-current={pathname === '/' ? 'page' : undefined}>
          {t('recordings')}
        </Link>
        <Link
          href="/service-config"
          className={linkClass('/service-config')}
          aria-current={pathname === '/service-config' ? 'page' : undefined}
        >
          {t('aiConfig')}
        </Link>
        <Link href="/pair" className={linkClass('/pair')} aria-current={pathname === '/pair' ? 'page' : undefined}>
          {t('bindDevice')}
        </Link>
        <Link href="/tutorial" className={linkClass('/tutorial')} aria-current={pathname === '/tutorial' ? 'page' : undefined}>
          {t('tutorial')}
        </Link>
      </div>

      <div className="top-nav-tools">
        <button
          type="button"
          onClick={switchLocale}
          className="top-nav-link top-nav-link-tool"
          style={{ cursor: 'pointer', fontWeight: 600, letterSpacing: '0.02em' }}
        >
          {locale === 'zh' ? 'EN' : '中文'}
        </button>
        <Link href="/preview_package" className={linkClass('/preview_package', 'top-nav-link-tool')}>
          {t('getPackage')}
        </Link>
        <Link href="/account" className={linkClass('/account', 'top-nav-link-tool')}>
          {t('account')}
        </Link>
        <button type="button" onClick={logout} disabled={busy} className="top-nav-link top-nav-link-danger">
          {busy ? t('loggingOut') : t('logout')}
        </button>
      </div>
    </nav>
  )
}
