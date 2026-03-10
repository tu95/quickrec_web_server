'use client'

import { useEffect, useState } from 'react'
import { useCachedApi } from '../_lib/use-cached-api'

export default function AccountPage() {
  const [loading, setLoading] = useState(true)
  const [profileBusy, setProfileBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [cacheUserId, setCacheUserId] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [quota, setQuota] = useState({
    loading: true,
    error: '',
    limit: 0,
    usedCount: 0,
    remaining: 0
  })
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const meApi = useCachedApi({
    apiPath: '/api/user-auth/me',
    userId: cacheUserId || 'session-auth',
    ttlMs: 30 * 1000,
    enabled: true,
    allowUserIdFallback: false,
    initialData: null,
    successGuard: payload => !!(payload?.success && typeof payload?.authenticated === 'boolean')
  })
  const quotaApi = useCachedApi({
    apiPath: '/api/user/quota/meeting-notes',
    userId: cacheUserId,
    ttlMs: 20 * 1000,
    enabled: Boolean(cacheUserId),
    initialData: null,
    successGuard: (payload) => !!payload?.success
  })

  useEffect(() => {
    const data = meApi.data
    if (!data || data.success !== true) return
    if (!data.authenticated) {
      const next = encodeURIComponent('/account')
      window.location.href = `/login?next=${next}`
      return
    }
    setEmail(String(data?.user?.email || '').trim())
    setDisplayName(String(data?.user?.displayName || '').trim())
    setCacheUserId(String(data?.user?.id || '').trim())
    setLoading(false)
  }, [meApi.data])

  useEffect(() => {
    if (!meApi.error) return
    if (Number(meApi.error?.status || 0) === 401) {
      const next = encodeURIComponent('/account')
      window.location.href = `/login?next=${next}`
      return
    }
    if (!meApi.cacheMessage) {
      setError(String(meApi.error?.message || meApi.error))
    }
    setLoading(false)
  }, [meApi.error, meApi.cacheMessage])

  useEffect(() => {
    if (!cacheUserId) return
    if (quotaApi.isLoading && !quotaApi.data) {
      setQuota(prev => ({ ...prev, loading: true, error: '' }))
      return
    }
    if (quotaApi.error && !quotaApi.data) {
      setQuota(prev => ({
        ...prev,
        loading: false,
        error: String(quotaApi.error?.message || quotaApi.error)
      }))
      return
    }
    const data = quotaApi.data
    if (!data || data.success !== true) return
    setQuota({
      loading: Boolean(quotaApi.isLoading),
      error: quotaApi.error ? String(quotaApi.error?.message || quotaApi.error) : '',
      limit: Number(data?.limit || 0),
      usedCount: Number(data?.usedCount || 0),
      remaining: Number(data?.remaining || 0)
    })
  }, [cacheUserId, quotaApi.data, quotaApi.error, quotaApi.isLoading])

  async function saveProfile() {
    setProfileBusy(true)
    setMessage('')
    setError('')
    try {
      const name = String(displayName || '').trim()
      if (!name) throw new Error('用户名不能为空')
      const res = await fetch('/api/user-auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setDisplayName(String(data?.user?.displayName || name))
      setMessage('用户名已更新')
      void meApi.refresh()
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setProfileBusy(false)
    }
  }

  async function changePassword() {
    setPasswordBusy(true)
    setMessage('')
    setError('')
    try {
      const oldPwd = String(oldPassword || '')
      const newPwd = String(newPassword || '')
      const confirmPwd = String(confirmPassword || '')
      if (!oldPwd || !newPwd || !confirmPwd) {
        throw new Error('请完整填写旧密码和两次新密码')
      }
      if (newPwd !== confirmPwd) {
        throw new Error('两次新密码不一致')
      }
      const res = await fetch('/api/user-auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassword: oldPwd,
          newPassword: newPwd,
          confirmPassword: confirmPwd
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('密码已更新')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <main className="page-root pair-shell">
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>账户设置</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>可在此修改用户名与登录密码。</p>
        {email && (
          <div className="server-pill" style={{ marginTop: 12 }}>
            <span>当前账号</span>
            <code>{email}</code>
          </div>
        )}
        <div style={quotaCountRowStyle}>
          <span style={quotaCountTagStyle}>👑 会议纪要次数：</span>
          <strong style={quotaCountTextStyle}>
            {quota.loading
              ? '加载中...'
              : quota.error
                ? '加载失败'
                : `${Math.max(0, quota.remaining)}`}
          </strong>
        </div>
      </section>

      {!quota.loading && !quota.error && (
        <section className="panel panel-dark" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>会议纪要额度</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <div className="server-pill"><span>总额度</span><code>{Math.max(0, quota.limit)}</code></div>
            <div className="server-pill"><span>已使用</span><code>{Math.max(0, quota.usedCount)}</code></div>
            <div className="server-pill"><span>剩余</span><code>{Math.max(0, quota.remaining)}</code></div>
          </div>
        </section>
      )}

      {!quota.loading && quota.error && (
        <div className="ui-notice ui-notice-error" style={{ marginBottom: 14 }}>
          会议纪要余额加载失败: {quota.error}
        </div>
      )}
      {meApi.cacheMessage && (
        <div className="ui-notice ui-notice-info" style={{ marginBottom: 14 }}>
          {meApi.cacheMessage}
        </div>
      )}
      {quotaApi.cacheMessage && (
        <div className="ui-notice ui-notice-info" style={{ marginBottom: 14 }}>
          {quotaApi.cacheMessage}
        </div>
      )}

      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>修改用户名</h3>
        <label className="ui-label" htmlFor="account-display-name">用户名</label>
        <input
          id="account-display-name"
          className="ui-input"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          maxLength={32}
          placeholder="请输入用户名"
          disabled={loading || profileBusy}
        />
        <div className="action-row">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={saveProfile}
            disabled={loading || profileBusy}
          >
            {profileBusy ? '保存中...' : '保存用户名'}
          </button>
        </div>
      </section>

      <section className="panel panel-dark">
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>修改密码</h3>
        <label className="ui-label" htmlFor="account-old-password">旧密码</label>
        <input
          id="account-old-password"
          className="ui-input"
          type="password"
          value={oldPassword}
          onChange={e => setOldPassword(e.target.value)}
          placeholder="请输入旧密码"
          disabled={loading || passwordBusy}
        />
        <label className="ui-label" htmlFor="account-new-password">新密码</label>
        <input
          id="account-new-password"
          className="ui-input"
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder="请输入新密码"
          disabled={loading || passwordBusy}
        />
        <label className="ui-label" htmlFor="account-confirm-password">确认新密码</label>
        <input
          id="account-confirm-password"
          className="ui-input"
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="请再次输入新密码"
          disabled={loading || passwordBusy}
        />
        <div className="action-row">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={changePassword}
            disabled={loading || passwordBusy}
          >
            {passwordBusy ? '更新中...' : '更新密码'}
          </button>
        </div>
      </section>
      {message && <div className="ui-notice ui-notice-success">{message}</div>}
      {error && <div className="ui-notice ui-notice-error">{error}</div>}
    </main>
  )
}

const quotaCountRowStyle = {
  marginTop: 10,
  width: '100%',
  minHeight: 52,
  borderRadius: 14,
  border: '1px solid rgba(110, 184, 255, 0.35)',
  background: 'linear-gradient(135deg, rgba(94, 142, 255, 0.22), rgba(117, 233, 255, 0.2))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 14px'
}

const quotaCountTagStyle = {
  fontSize: 14,
  color: '#d9f0ff',
  fontWeight: 700
}

const quotaCountTextStyle = {
  fontSize: 24,
  lineHeight: 1,
  letterSpacing: '0.01em',
  color: '#ffffff',
  fontWeight: 800
}
