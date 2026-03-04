'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const MODE = {
  login: 'login',
  register: 'register',
  forgot: 'forgot',
  reset: 'reset'
}

const TURNSTILE_SITE_KEY = String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim()
const TURNSTILE_ENABLED = !!TURNSTILE_SITE_KEY

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  const existing = document.querySelector('script[data-turnstile-script="1"]')
  if (existing) {
    return new Promise(resolve => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => resolve(), { once: true })
    })
  }
  return new Promise(resolve => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = '1'
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
}

function normalizeMode(value) {
  const text = String(value || '').trim().toLowerCase()
  return MODE[text] || MODE.login
}

function readRecoveryToken(url) {
  const hash = new URLSearchParams(String(url.hash || '').replace(/^#/, ''))
  const query = url.searchParams
  return String(hash.get('access_token') || query.get('access_token') || '').trim()
}

function detectMode(url) {
  const queryMode = normalizeMode(url.searchParams.get('mode'))
  if (queryMode !== MODE.login) return queryMode
  const hash = new URLSearchParams(String(url.hash || '').replace(/^#/, ''))
  const recoveryType = String(hash.get('type') || url.searchParams.get('type') || '').toLowerCase()
  const token = readRecoveryToken(url)
  if (token && recoveryType === 'recovery') return MODE.reset
  return MODE.login
}

function safeNext(url) {
  const next = String(url.searchParams.get('next') || '').trim()
  if (next.startsWith('/')) return next
  return '/'
}

function updateUrlMode(nextMode) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const mode = normalizeMode(nextMode)
  if (mode === MODE.login) {
    url.searchParams.delete('mode')
  } else {
    url.searchParams.set('mode', mode)
  }
  if (mode !== MODE.reset && String(url.hash || '').includes('access_token')) {
    url.hash = ''
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function humanizeAuthError(raw) {
  const text = String(raw || '').trim()
  if (!text) return '请求失败，请稍后重试。'
  const lowered = text.toLowerCase()
  if (lowered.includes('email not confirmed')) {
    return '邮箱还未验证，请先点“重发确认邮件”，验证后再登录。'
  }
  if (lowered.includes('invalid login credentials')) {
    return '邮箱或密码不正确，请检查后再试。'
  }
  if (lowered.includes('rate limit') || lowered.includes('too many')) {
    return '请求太频繁了，请稍后再试。'
  }
  if (lowered.includes('email rate limit exceeded')) {
    return '邮件发送过于频繁，请稍后再试。若你已配置 Brevo，请检查 Supabase Custom SMTP 是否启用。'
  }
  if (lowered.includes('smtp')) {
    return '邮件服务暂时不可用，请稍后重试。'
  }
  if (lowered.includes('captcha') || lowered.includes('turnstile')) {
    return '人机验证失败，请刷新后重试。'
  }
  return text
}

export default function LoginPage() {
  const [mode, setMode] = useState(MODE.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [recoveryToken, setRecoveryToken] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const turnstileContainerRef = useRef(null)
  const turnstileWidgetIdRef = useRef(null)

  useEffect(() => {
    bootstrap().catch(() => {})
  }, [])

  useEffect(() => {
    if (!TURNSTILE_ENABLED) return
    if (mode === MODE.reset) return
    let disposed = false
    loadTurnstileScript().then(() => {
      if (disposed) return
      if (!window.turnstile || !turnstileContainerRef.current) return
      try {
        if (turnstileWidgetIdRef.current !== null) {
          window.turnstile.remove(turnstileWidgetIdRef.current)
          turnstileWidgetIdRef.current = null
        }
      } catch {}
      turnstileContainerRef.current.innerHTML = ''
      try {
        const widgetId = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (token) => {
            setTurnstileToken(String(token || ''))
          },
          'expired-callback': () => {
            setTurnstileToken('')
          },
          'error-callback': () => {
            setTurnstileToken('')
          }
        })
        turnstileWidgetIdRef.current = widgetId
      } catch {
        setTurnstileToken('')
      }
    })
    return () => {
      disposed = true
    }
  }, [mode])

  const title = useMemo(() => {
    if (mode === MODE.register) return '创建账号'
    if (mode === MODE.forgot) return '找回密码'
    if (mode === MODE.reset) return '重置密码'
    return '邮箱登录'
  }, [mode])

  async function bootstrap() {
    const url = new URL(window.location.href)
    const nextMode = detectMode(url)
    const token = readRecoveryToken(url)
    setMode(nextMode)
    setRecoveryToken(token)
    if (nextMode === MODE.reset && token) {
      updateUrlMode(MODE.reset)
      return
    }
    const res = await fetch('/api/user-auth/me', { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return
    const data = await res.json().catch(() => null)
    if (data?.success && data?.authenticated) {
      window.location.href = safeNext(url)
    }
  }

  function switchMode(nextMode) {
    const resolved = normalizeMode(nextMode)
    setMode(resolved)
    setError('')
    setMessage('')
    setPassword('')
    setConfirmPassword('')
    if (resolved !== MODE.reset) {
      setRecoveryToken('')
    }
    resetTurnstileToken()
    updateUrlMode(resolved)
  }

  function resetTurnstileToken() {
    if (!TURNSTILE_ENABLED) return
    setTurnstileToken('')
    if (typeof window === 'undefined' || !window.turnstile) return
    if (turnstileWidgetIdRef.current === null) return
    try {
      window.turnstile.reset(turnstileWidgetIdRef.current)
    } catch {}
  }

  async function submit() {
    let consumedTurnstile = false
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const safeEmail = String(email || '').trim()
      const safePassword = String(password || '')
      const safeTurnstileToken = String(turnstileToken || '').trim()
      if (mode === MODE.forgot) {
        if (!safeEmail) throw new Error('请输入邮箱')
        if (TURNSTILE_ENABLED && !safeTurnstileToken) {
          throw new Error('请先完成人机验证')
        }
        consumedTurnstile = TURNSTILE_ENABLED
        const res = await fetch('/api/user-auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: safeEmail, turnstileToken: safeTurnstileToken })
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `请求失败: HTTP ${res.status}`)
        }
        setMessage(String(data?.message || '重置密码邮件已发送'))
        return
      }

      if (!safePassword) throw new Error('请输入密码')
      if (safePassword.length < 6) throw new Error('密码至少 6 位')

      if (mode === MODE.register || mode === MODE.reset) {
        if (safePassword !== String(confirmPassword || '')) {
          throw new Error('两次输入密码不一致')
        }
      }

      if (mode === MODE.register) {
        if (!safeEmail) throw new Error('请输入邮箱')
        if (TURNSTILE_ENABLED && !safeTurnstileToken) {
          throw new Error('请先完成人机验证')
        }
        consumedTurnstile = TURNSTILE_ENABLED
        const res = await fetch('/api/user-auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: safeEmail,
            password: safePassword,
            turnstileToken: safeTurnstileToken
          })
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `请求失败: HTTP ${res.status}`)
        }
        if (data.requiresEmailConfirm) {
          switchMode(MODE.login)
          setMessage('注册成功，请先完成邮箱验证后再登录。')
          return
        }
        const next = safeNext(new URL(window.location.href))
        window.location.href = next
        return
      }

      if (mode === MODE.reset) {
        const headers = { 'Content-Type': 'application/json' }
        if (recoveryToken) {
          headers.Authorization = `Bearer ${recoveryToken}`
        }
        const res = await fetch('/api/user-auth/update-password', {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: safePassword })
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `请求失败: HTTP ${res.status}`)
        }
        switchMode(MODE.login)
        setMessage('密码已更新，请使用新密码登录。')
        return
      }

      if (!safeEmail) throw new Error('请输入邮箱')
      if (TURNSTILE_ENABLED && !safeTurnstileToken) {
        throw new Error('请先完成人机验证')
      }
      consumedTurnstile = TURNSTILE_ENABLED
      const res = await fetch('/api/user-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: safeEmail,
          password: safePassword,
          turnstileToken: safeTurnstileToken
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `请求失败: HTTP ${res.status}`)
      }
      const next = safeNext(new URL(window.location.href))
      window.location.href = next
    } catch (err) {
      setError(humanizeAuthError(err?.message || err))
    } finally {
      if (consumedTurnstile) {
        resetTurnstileToken()
      }
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    let consumedTurnstile = false
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const safeEmail = String(email || '').trim()
      const safeTurnstileToken = String(turnstileToken || '').trim()
      if (!safeEmail) throw new Error('请先输入邮箱')
      if (TURNSTILE_ENABLED && !safeTurnstileToken) {
        throw new Error('请先完成人机验证')
      }
      consumedTurnstile = TURNSTILE_ENABLED
      const res = await fetch('/api/user-auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: safeEmail, turnstileToken: safeTurnstileToken })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `请求失败: HTTP ${res.status}`)
      }
      setMessage(String(data?.message || '确认邮件已发送'))
    } catch (err) {
      setError(humanizeAuthError(err?.message || err))
    } finally {
      if (consumedTurnstile) {
        resetTurnstileToken()
      }
      setBusy(false)
    }
  }

  return (
    <main className="page-root auth-shell">
      <section className="panel panel-dark auth-card">
        <p className="hero-kicker">QuickRec Account</p>
        <h1 className="hero-title">{title}</h1>
        <p className="hero-subtitle">使用 Supabase Auth 完成邮箱登录、注册与密码找回。</p>

        {mode !== MODE.reset && (
          <div className="segmented">
            <button
              type="button"
              onClick={() => switchMode(MODE.login)}
              disabled={busy}
              className={`segmented-btn ${mode === MODE.login ? 'segmented-btn-active' : ''}`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => switchMode(MODE.register)}
              disabled={busy}
              className={`segmented-btn ${mode === MODE.register ? 'segmented-btn-active' : ''}`}
            >
              注册
            </button>
            <button
              type="button"
              onClick={() => switchMode(MODE.forgot)}
              disabled={busy}
              className={`segmented-btn ${mode === MODE.forgot ? 'segmented-btn-active' : ''}`}
            >
              找回密码
            </button>
          </div>
        )}

        {mode !== MODE.reset && (
          <>
            <label className="ui-label">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="ui-input"
            />
          </>
        )}

        {mode !== MODE.forgot && (
          <>
            <label className="ui-label">{mode === MODE.reset ? '新密码' : '密码'}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="至少 6 位"
              className="ui-input"
            />
          </>
        )}

        {(mode === MODE.register || mode === MODE.reset) && (
          <>
            <label className="ui-label">确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="再次输入密码"
              className="ui-input"
            />
          </>
        )}

        {TURNSTILE_ENABLED && mode !== MODE.reset && (
          <div className="pair-step-card" style={{ marginTop: 12, overflowX: 'auto' }}>
            <div ref={turnstileContainerRef} />
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {turnstileToken ? '安全验证已通过，可继续提交。' : '请先完成人机验证。'}
            </div>
          </div>
        )}

        <button className="ui-btn ui-btn-primary auth-switch" onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
          {busy ? '处理中...' : mode === MODE.forgot ? '发送重置邮件' : mode === MODE.reset ? '更新密码' : mode === MODE.register ? '注册账号' : '登录'}
        </button>

        {mode === MODE.login && (
          <div className="action-row">
            <button type="button" onClick={resendConfirmation} disabled={busy} className="ui-btn ui-btn-secondary auth-switch">
              重发确认邮件
            </button>
          </div>
        )}

        {mode === MODE.reset && (
          <div className="action-row">
            <button type="button" onClick={() => switchMode(MODE.login)} disabled={busy} className="ui-btn ui-btn-secondary auth-switch">
              返回登录
            </button>
          </div>
        )}

        {message && <div className="ui-notice ui-notice-success">{message}</div>}
        {error && <div className="ui-notice ui-notice-error">{error}</div>}
      </section>
    </main>
  )
}
