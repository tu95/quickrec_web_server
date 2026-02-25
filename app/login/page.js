'use client'

import { useEffect, useState } from 'react'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    checkAuthed()
  }, [])

  async function checkAuthed() {
    const res = await fetch('/api/site-auth/me', { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return
    const next = new URL(window.location.href).searchParams.get('next') || '/'
    window.location.href = next
  }

  async function login() {
    if (!password.trim()) {
      setError('请输入访问密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/site-auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          password: password.trim()
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `登录失败: HTTP ${res.status}`)
      }
      const next = new URL(window.location.href).searchParams.get('next') || '/'
      window.location.href = next
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-root" style={{ maxWidth: 520, minHeight: '100vh', display: 'grid', alignItems: 'center' }}>
      <section className="panel" style={{ padding: 18 }}>
        <p className="hero-kicker">Access Control</p>
        <h1 className="hero-title" style={{ fontSize: 30 }}>网站访问登录</h1>
        <p className="hero-subtitle">请输入站点密码，登录后才能访问文件与 AI 服务。</p>
        <label style={labelStyle}>访问密码</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') login()
          }}
          placeholder="输入密码"
          style={inputStyle}
        />
        <button style={buttonStyle} onClick={login} disabled={busy}>
          {busy ? '登录中...' : '登录'}
        </button>
        {error && <div style={errorStyle}>{error}</div>}
      </section>
    </main>
  )
}

const labelStyle = {
  display: 'block',
  marginTop: 12,
  marginBottom: 8,
  color: '#33545b',
  fontSize: 12,
  fontWeight: 700
}

const inputStyle = {
  width: '100%',
  border: '1px solid rgba(31, 87, 102, 0.28)',
  borderRadius: 12,
  minHeight: 46,
  padding: '11px 12px',
  fontSize: 14,
  color: '#203f47',
  background: 'rgba(255,255,255,0.95)'
}

const buttonStyle = {
  marginTop: 12,
  border: '1px solid rgba(10, 126, 118, 0.45)',
  borderRadius: 999,
  minHeight: 44,
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 700,
  color: '#114e55',
  background: 'linear-gradient(135deg, rgba(6,170,158,0.28), rgba(247,182,90,0.22))',
  cursor: 'pointer'
}

const errorStyle = {
  marginTop: 10,
  padding: '10px 12px',
  border: '1px solid rgba(185, 77, 77, 0.38)',
  borderRadius: 10,
  color: '#8e2c2c',
  background: 'rgba(255, 241, 241, 0.92)'
}

