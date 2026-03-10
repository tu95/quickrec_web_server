'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { clearCurrentUserApiCaches } from './_lib/client-cache'

export default function HomeAuthActions() {
  const [busy, setBusy] = useState(false)
  const pathname = usePathname()

  function linkClass(target, extra = '') {
    const active = pathname === target
    return ['top-nav-link', active ? 'top-nav-link-active' : '', extra].filter(Boolean).join(' ')
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
        window.location.href = '/login'
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
    <nav className="top-nav-shell" aria-label="快速导航">
      <div className="top-nav-main">
        <Link href="/" className={linkClass('/')} aria-current={pathname === '/' ? 'page' : undefined}>
          录音文件
        </Link>
        <Link
          href="/service-config"
          className={linkClass('/service-config')}
          aria-current={pathname === '/service-config' ? 'page' : undefined}
        >
          AI服务配置
        </Link>
        <Link href="/pair" className={linkClass('/pair')} aria-current={pathname === '/pair' ? 'page' : undefined}>
          绑定设备
        </Link>
        <Link href="/tutorial" className={linkClass('/tutorial')} aria-current={pathname === '/tutorial' ? 'page' : undefined}>
          使用教程
        </Link>
      </div>

      <div className="top-nav-tools">
        <Link href="/preview_package" className={linkClass('/preview_package', 'top-nav-link-tool')}>
          获取安装包
        </Link>
        <Link href="/account" className={linkClass('/account', 'top-nav-link-tool')}>
          账户
        </Link>
        <button type="button" onClick={logout} disabled={busy} className="top-nav-link top-nav-link-danger">
          {busy ? '退出中...' : '退出登录'}
        </button>
      </div>
    </nav>
  )
}
