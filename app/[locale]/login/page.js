'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'

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

export default function LoginPage() {
  const t = useTranslations('login')
  const locale = useLocale()
  const [mode, setMode] = useState(MODE.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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
    if (mode === MODE.register) return t('titleRegister')
    if (mode === MODE.forgot) return t('titleForgot')
    if (mode === MODE.reset) return t('titleReset')
    return t('titleLogin')
  }, [mode, t])

  function humanizeAuthError(raw) {
    const text = String(raw || '').trim()
    if (!text) return t('errDefault')
    const lowered = text.toLowerCase()
    if (lowered.includes('email not confirmed')) return t('errEmailNotConfirmed')
    if (lowered.includes('invalid login credentials')) return t('errInvalidCredentials')
    if (lowered.includes('rate limit') || lowered.includes('too many')) return t('errRateLimit')
    if (lowered.includes('email rate limit exceeded')) return t('errEmailRateLimit')
    if (lowered.includes('smtp')) return t('errSmtp')
    if (lowered.includes('captcha') || lowered.includes('turnstile')) return t('errCaptcha')
    return text
  }

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
    setShowPassword(false)
    setShowConfirmPassword(false)
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
        if (!safeEmail) throw new Error(t('errEnterEmail'))
        if (TURNSTILE_ENABLED && !safeTurnstileToken) {
          throw new Error(t('errCompleteCaptcha'))
        }
        consumedTurnstile = TURNSTILE_ENABLED
        const res = await fetch('/api/user-auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: safeEmail, turnstileToken: safeTurnstileToken })
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || t('errRequestHttp', { status: res.status }))
        }
        setMessage(String(data?.message || t('msgResetSent')))
        return
      }

      if (!safePassword) throw new Error(t('errEnterPassword'))
      if (safePassword.length < 6) throw new Error(t('errPasswordShort'))

      if (mode === MODE.register || mode === MODE.reset) {
        if (safePassword !== String(confirmPassword || '')) {
          throw new Error(t('errPasswordMismatch'))
        }
      }

      if (mode === MODE.register) {
        if (!safeEmail) throw new Error(t('errEnterEmail'))
        if (TURNSTILE_ENABLED && !safeTurnstileToken) {
          throw new Error(t('errCompleteCaptcha'))
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
          throw new Error(data?.error || t('errRequestHttp', { status: res.status }))
        }
        if (data.requiresEmailConfirm) {
          switchMode(MODE.login)
          setMessage(t('msgRegisterSuccess'))
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
          throw new Error(data?.error || t('errRequestHttp', { status: res.status }))
        }
        switchMode(MODE.login)
        setMessage(t('msgPasswordUpdated'))
        return
      }

      if (!safeEmail) throw new Error(t('errEnterEmail'))
      if (TURNSTILE_ENABLED && !safeTurnstileToken) {
        throw new Error(t('errCompleteCaptcha'))
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
        throw new Error(data?.error || t('errRequestHttp', { status: res.status }))
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
      if (!safeEmail) throw new Error(t('errEnterEmail'))
      if (TURNSTILE_ENABLED && !safeTurnstileToken) {
        throw new Error(t('errCompleteCaptcha'))
      }
      consumedTurnstile = TURNSTILE_ENABLED
      const res = await fetch('/api/user-auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: safeEmail, turnstileToken: safeTurnstileToken })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || t('errRequestHttp', { status: res.status }))
      }
      setMessage(String(data?.message || t('msgConfirmationSent')))
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
        <p className="hero-kicker">{t('heroKicker')}</p>
        <h1 className="hero-title">{title}</h1>

        {mode !== MODE.reset && (
          <div className="segmented">
            <button
              type="button"
              onClick={() => switchMode(MODE.login)}
              disabled={busy}
              className={`segmented-btn ${mode === MODE.login ? 'segmented-btn-active' : ''}`}
            >
              {t('tabLogin')}
            </button>
            <button
              type="button"
              onClick={() => switchMode(MODE.register)}
              disabled={busy}
              className={`segmented-btn ${mode === MODE.register ? 'segmented-btn-active' : ''}`}
            >
              {t('tabRegister')}
            </button>
            <button
              type="button"
              onClick={() => switchMode(MODE.forgot)}
              disabled={busy}
              className={`segmented-btn ${mode === MODE.forgot ? 'segmented-btn-active' : ''}`}
            >
              {t('tabForgot')}
            </button>
          </div>
        )}

        {mode !== MODE.reset && (
          <>
            <label className="ui-label">{t('email')}</label>
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
            <label className="ui-label">{mode === MODE.reset ? t('newPassword') : t('password')}</label>
            <div style={passwordFieldWrapStyle}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder={t('passwordPlaceholder')}
                className="ui-input"
                style={passwordInputStyle}
              />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                className="ui-btn ui-btn-secondary"
                style={passwordToggleBtnStyle}
              >
                {showPassword ? t('hide') : t('show')}
              </button>
            </div>
          </>
        )}

        {(mode === MODE.register || mode === MODE.reset) && (
          <>
            <label className="ui-label">{t('confirmPassword')}</label>
            <div style={passwordFieldWrapStyle}>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder={t('confirmPlaceholder')}
                className="ui-input"
                style={passwordInputStyle}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(value => !value)}
                className="ui-btn ui-btn-secondary"
                style={passwordToggleBtnStyle}
              >
                {showConfirmPassword ? t('hide') : t('show')}
              </button>
            </div>
          </>
        )}

        {TURNSTILE_ENABLED && mode !== MODE.reset && (
          <div className="pair-step-card" style={{ marginTop: 12, overflowX: 'auto' }}>
            <div ref={turnstileContainerRef} />
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {turnstileToken ? t('turnstileVerified') : t('turnstilePending')}
            </div>
          </div>
        )}

        <button className="ui-btn ui-btn-primary auth-switch" onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
          {busy ? t('processing') : mode === MODE.forgot ? t('sendReset') : mode === MODE.reset ? t('updatePassword') : mode === MODE.register ? t('createAccount') : t('loginAction')}
        </button>

        {mode === MODE.login && (
          <div className="action-row">
            <button type="button" onClick={resendConfirmation} disabled={busy} className="ui-btn ui-btn-secondary auth-switch">
              {t('resendConfirmation')}
            </button>
          </div>
        )}

        {mode === MODE.reset && (
          <div className="action-row">
            <button type="button" onClick={() => switchMode(MODE.login)} disabled={busy} className="ui-btn ui-btn-secondary auth-switch">
              {t('backToLogin')}
            </button>
          </div>
        )}

        {message && <div className="ui-notice ui-notice-success">{message}</div>}
        {error && <div className="ui-notice ui-notice-error">{error}</div>}
      </section>
    </main>
  )
}

const passwordFieldWrapStyle = {
  position: 'relative'
}

const passwordInputStyle = {
  paddingRight: 86
}

const passwordToggleBtnStyle = {
  position: 'absolute',
  right: 8,
  top: 8,
  minHeight: 32,
  height: 32,
  padding: '0 12px',
  fontSize: 12,
  borderRadius: 10
}
