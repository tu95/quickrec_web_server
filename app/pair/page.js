'use client'

import { useEffect, useMemo, useState } from 'react'

function maskToken(token) {
  const text = String(token || '')
  if (!text) return ''
  if (text.length <= 12) return `${text.slice(0, 4)}******`
  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

function formatDateTime(value) {
  const text = String(value || '').trim()
  if (!text) return '-'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString('zh-CN', { hour12: false })
}

function statusText(status) {
  const raw = String(status || '').trim().toLowerCase()
  if (raw === 'active') return 'active（可用）'
  if (raw === 'disabled') return 'disabled（已禁用）'
  return raw || '-'
}

export default function PairPage() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pairCode, setPairCode] = useState('')
  const [user, setUser] = useState(null)
  const [devices, setDevices] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [latestSessionToken, setLatestSessionToken] = useState('')
  const [latestSessionExpiresAt, setLatestSessionExpiresAt] = useState('')

  useEffect(() => {
    bootstrap().catch(() => {})
  }, [])

  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => String(b.boundAt || '').localeCompare(String(a.boundAt || '')))
  }, [devices])

  async function bootstrap() {
    setLoading(true)
    setError('')
    try {
      const meRes = await fetch('/api/user-auth/me', { cache: 'no-store' })
      const meData = await meRes.json().catch(() => null)
      if (!meRes.ok || !meData?.success || !meData?.authenticated) {
        const next = encodeURIComponent('/pair')
        window.location.href = `/login?next=${next}`
        return
      }
      setUser(meData.user || null)
      await loadDevices()
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  async function loadDevices() {
    const res = await fetch('/api/user/devices', { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `加载设备失败: HTTP ${res.status}`)
    }
    setDevices(Array.isArray(data.devices) ? data.devices : [])
  }

  async function bindPairCode() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const code = String(pairCode || '').trim()
      if (!code) {
        throw new Error('请输入配对码')
      }
      const res = await fetch('/api/user/devices/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairCode: code })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `绑定失败: HTTP ${res.status}`)
      }
      setMessage(`绑定成功，设备 ${data?.device?.deviceId || data?.device?.id || ''} 已关联到当前账号。`)
      setLatestSessionToken(String(data?.sessionToken || ''))
      setLatestSessionExpiresAt(String(data?.sessionExpiresAt || ''))
      setPairCode('')
      await loadDevices()
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      await fetch('/api/user-auth/logout', { method: 'POST' })
      window.location.href = '/login?next=/pair'
    } catch {
      window.location.href = '/login?next=/pair'
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-root pair-shell">
      <section className="hero">
        <p className="hero-kicker">Pair Device</p>
        <h1 className="hero-title">手表配对绑定</h1>
        <p className="hero-subtitle">手表端获取配对码后，在这里完成设备绑定。绑定成功后，上传将归属到你的账号。</p>
        {user?.email && (
          <div className="server-pill">
            <span>当前账号</span>
            <code>{user.email}</code>
          </div>
        )}
      </section>

      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <div className="pair-steps">
          <div className="pair-step-card">
            <strong>步骤 1：</strong>在手表设置页获取配对码。
          </div>
          <div className="pair-step-card">
            <strong>步骤 2：</strong>把配对码填入下方输入框并提交绑定。
          </div>
          <div className="pair-step-card">
            <strong>步骤 3：</strong>设备会话下发后，手表上传即自动归档到当前账号。
          </div>
        </div>
      </section>

      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>输入配对码</h3>
        <div className="action-row">
          <input
            value={pairCode}
            onChange={e => setPairCode(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') bindPairCode()
            }}
            placeholder="例如 472918"
            className="ui-input"
            maxLength={12}
            style={{ minWidth: 220, flex: 1 }}
          />
          <button onClick={bindPairCode} disabled={busy || loading} className="ui-btn ui-btn-primary">
            {busy ? '绑定中...' : '绑定设备'}
          </button>
        </div>

        <div className="action-row">
          <button onClick={logout} disabled={busy} className="ui-btn ui-btn-danger">
            退出登录
          </button>
        </div>

        {message && <div className="ui-notice ui-notice-success">{message}</div>}
        {error && <div className="ui-notice ui-notice-error">{error}</div>}

        {latestSessionToken && (
          <div className="ui-notice ui-notice-info">
            <div>设备会话：{maskToken(latestSessionToken)}</div>
            <div>过期时间：{formatDateTime(latestSessionExpiresAt)}</div>
          </div>
        )}
      </section>

      <section className="panel panel-dark">
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>已绑定设备</h3>
        {loading ? (
          <p className="muted">加载中...</p>
        ) : sortedDevices.length === 0 ? (
          <p className="muted">暂无绑定设备</p>
        ) : (
          <div className="device-grid">
            {sortedDevices.map(item => (
              <div key={`${item.id}_${item.boundAt}`} className="device-card">
                <div><strong>设备标识：</strong>{item.deviceId || '-'}</div>
                <div><strong>来源：</strong>{item.identitySource || '-'}</div>
                <div><strong>状态：</strong>{statusText(item.status)}</div>
                <div><strong>绑定时间：</strong>{formatDateTime(item.boundAt)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
