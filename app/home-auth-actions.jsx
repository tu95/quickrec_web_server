'use client'

import { useState } from 'react'

export default function HomeAuthActions() {
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    try {
      const res = await fetch('/api/site-auth/logout', { method: 'POST' })
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
    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a
        href="/settings"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 42,
          padding: '8px 14px',
          borderRadius: 999,
          border: '1px solid rgba(23, 84, 90, 0.3)',
          background: 'rgba(255,255,255,0.74)',
          color: '#214f56',
          fontWeight: 700,
          textDecoration: 'none'
        }}
      >
        设置
      </a>
      <a
        href="/preview_package"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 42,
          padding: '8px 14px',
          borderRadius: 999,
          border: '1px solid rgba(28, 107, 73, 0.3)',
          background: 'rgba(243, 255, 246, 0.86)',
          color: '#1d6b4a',
          fontWeight: 700,
          textDecoration: 'none'
        }}
      >
        🔥🔥🔥🔥获取安装包
      </a>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 42,
          padding: '8px 14px',
          borderRadius: 999,
          border: '1px solid rgba(159, 54, 54, 0.32)',
          background: 'rgba(255, 244, 244, 0.82)',
          color: '#8e2f2f',
          fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.72 : 1
        }}
      >
        {busy ? '退出中...' : '退出登录'}
      </button>
    </div>
  )
}
