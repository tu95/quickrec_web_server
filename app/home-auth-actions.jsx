'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

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
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    } catch (error) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(String(error?.message || error))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <nav className="top-nav-shell" aria-label="快速导航">
      <a href="/" className={linkClass('/')}>
        首页
      </a>
      <a href="/pair" className={linkClass('/pair')}>
        绑定设备
      </a>
      <a href="/preview_package" className={linkClass('/preview_package')}>
        获取安装包
      </a>
      <a href="/tutorial" className={linkClass('/tutorial')}>
        教程
      </a>
      <a href="/account" className={linkClass('/account')}>
        账户
      </a>
      <button type="button" onClick={logout} disabled={busy} className="top-nav-link top-nav-link-danger">
        {busy ? '退出中...' : '退出登录'}
      </button>
    </nav>
  )
}
