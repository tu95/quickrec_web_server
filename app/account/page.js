'use client'

import { useEffect, useState } from 'react'

export default function AccountPage() {
  const [loading, setLoading] = useState(true)
  const [profileBusy, setProfileBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void bootstrap()
  }, [])

  async function bootstrap() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/user-auth/me', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data?.authenticated) {
        const next = encodeURIComponent('/account')
        window.location.href = `/login?next=${next}`
        return
      }
      setEmail(String(data?.user?.email || '').trim())
      setDisplayName(String(data?.user?.displayName || '').trim())
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

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
      <section className="hero">
        <p className="hero-kicker">Account</p>
        <h1 className="hero-title">账户设置</h1>
        <p className="hero-subtitle">可在此修改用户名与登录密码。</p>
        {email && (
          <div className="server-pill">
            <span>当前账号</span>
            <code>{email}</code>
          </div>
        )}
      </section>

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
