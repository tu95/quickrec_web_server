'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCachedApi } from '../_lib/use-cached-api'
import { clearCurrentUserApiCaches } from '../_lib/client-cache'

const PAIR_CODE_LENGTH = 6

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
  const [deletingDeviceId, setDeletingDeviceId] = useState('')
  const [pairDigits, setPairDigits] = useState(() => Array(PAIR_CODE_LENGTH).fill(''))
  const [cacheUserId, setCacheUserId] = useState('')
  const [user, setUser] = useState(null)
  const [devices, setDevices] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [latestSessionToken, setLatestSessionToken] = useState('')
  const [latestSessionExpiresAt, setLatestSessionExpiresAt] = useState('')
  const pairInputRefs = useRef([])
  const pairCode = useMemo(() => pairDigits.join(''), [pairDigits])
  const pairCodeReady = useMemo(
    () => pairDigits.every(item => /^\d$/.test(item)),
    [pairDigits]
  )
  const meApi = useCachedApi({
    apiPath: '/api/user-auth/me',
    userId: cacheUserId || 'session-auth',
    ttlMs: 30 * 1000,
    enabled: true,
    allowUserIdFallback: false,
    initialData: null,
    successGuard: payload => !!(payload?.success && typeof payload?.authenticated === 'boolean')
  })
  const devicesApi = useCachedApi({
    apiPath: '/api/user/devices',
    userId: cacheUserId,
    ttlMs: 60 * 1000,
    enabled: Boolean(cacheUserId),
    initialData: null,
    successGuard: (payload) => !!(payload?.success && Array.isArray(payload?.devices))
  })

  useEffect(() => {
    const data = meApi.data
    if (!data || data.success !== true) return
    if (!data.authenticated) {
      const next = encodeURIComponent('/pair')
      window.location.href = `/login?next=${next}`
      return
    }
    setUser(data.user || null)
    setCacheUserId(String(data?.user?.id || '').trim())
    setLoading(false)
  }, [meApi.data])

  useEffect(() => {
    if (!meApi.error) return
    if (Number(meApi.error?.status || 0) === 401) {
      const next = encodeURIComponent('/pair')
      window.location.href = `/login?next=${next}`
      return
    }
    if (!meApi.cacheMessage) {
      setError(String(meApi.error?.message || meApi.error))
    }
    setLoading(false)
  }, [meApi.error, meApi.cacheMessage])

  useEffect(() => {
    const data = devicesApi.data
    if (!data || data.success !== true || !Array.isArray(data.devices)) return
    setDevices(data.devices)
  }, [devicesApi.data])

  useEffect(() => {
    if (!devicesApi.error) return
    if (devicesApi.cacheMessage) return
    setError(String(devicesApi.error?.message || devicesApi.error))
  }, [devicesApi.error, devicesApi.cacheMessage])

  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => String(b.boundAt || '').localeCompare(String(a.boundAt || '')))
  }, [devices])

  async function loadDevices() {
    await devicesApi.refresh()
  }

  function focusPairInput(index) {
    const next = Number(index)
    if (!Number.isInteger(next)) return
    if (next < 0 || next >= PAIR_CODE_LENGTH) return
    const input = pairInputRefs.current[next]
    if (!input || typeof input.focus !== 'function') return
    input.focus()
    if (typeof input.select === 'function') {
      input.select()
    }
  }

  function fillPairDigitsFrom(startIndex, rawDigits) {
    const digits = String(rawDigits || '').replace(/\D/g, '')
    if (!digits) return
    setPairDigits(prev => {
      const next = Array.isArray(prev) ? [...prev] : Array(PAIR_CODE_LENGTH).fill('')
      let cursor = Number(startIndex)
      for (const digit of digits) {
        if (cursor < 0 || cursor >= PAIR_CODE_LENGTH) break
        next[cursor] = digit
        cursor += 1
      }
      return next
    })
    const focusIndex = Math.min(startIndex + digits.length, PAIR_CODE_LENGTH - 1)
    window.setTimeout(() => {
      focusPairInput(focusIndex)
    }, 0)
  }

  function handlePairDigitChange(index, rawValue) {
    const onlyDigits = String(rawValue || '').replace(/\D/g, '')
    if (!onlyDigits) {
      setPairDigits(prev => {
        const next = [...prev]
        next[index] = ''
        return next
      })
      return
    }
    if (onlyDigits.length > 1) {
      fillPairDigitsFrom(index, onlyDigits)
      return
    }
    const digit = onlyDigits.slice(0, 1)
    setPairDigits(prev => {
      const next = [...prev]
      next[index] = digit
      return next
    })
    if (index < PAIR_CODE_LENGTH - 1) {
      window.setTimeout(() => {
        focusPairInput(index + 1)
      }, 0)
    }
  }

  function handlePairDigitKeyDown(index, event) {
    const key = String(event?.key || '')
    if (key === 'Backspace') {
      const current = String(pairDigits[index] || '')
      if (!current && index > 0) {
        setPairDigits(prev => {
          const next = [...prev]
          next[index - 1] = ''
          return next
        })
        window.setTimeout(() => {
          focusPairInput(index - 1)
        }, 0)
      }
      return
    }
    if (key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      focusPairInput(index - 1)
      return
    }
    if (key === 'ArrowRight' && index < PAIR_CODE_LENGTH - 1) {
      event.preventDefault()
      focusPairInput(index + 1)
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      if (pairCodeReady && !busy && !loading) {
        void bindPairCode()
      } else {
        setError('请输入完整 6 位配对码')
      }
      return
    }
    if (key.length === 1 && /\D/.test(key)) {
      event.preventDefault()
    }
  }

  function handlePairPaste(event) {
    event.preventDefault()
    const pasted = String(event?.clipboardData?.getData('text') || '')
    const digits = pasted.replace(/\D/g, '')
    if (!digits) return
    fillPairDigitsFrom(0, digits)
  }

  async function bindPairCode() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const code = String(pairCode || '').trim()
      if (!/^\d{6}$/.test(code)) {
        throw new Error('请输入完整 6 位配对码')
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
      setPairDigits(Array(PAIR_CODE_LENGTH).fill(''))
      window.setTimeout(() => {
        focusPairInput(0)
      }, 0)
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
      clearCurrentUserApiCaches()
      window.location.href = '/login?next=/pair'
    } catch {
      clearCurrentUserApiCaches()
      window.location.href = '/login?next=/pair'
    } finally {
      setBusy(false)
    }
  }

  async function unbindDevice(device) {
    const id = String(device?.id || '').trim()
    if (!id) {
      setError('设备参数异常，缺少 ID')
      return
    }
    const label = String(device?.deviceId || id)
    const confirmed = window.confirm(`确认删除设备 ${label} 的绑定关系吗？`)
    if (!confirmed) return
    setDeletingDeviceId(id)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/user/devices/unbind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: id })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `删除失败: HTTP ${res.status}`)
      }
      const finalDeviceId = String(data?.device?.deviceId || label)
      setMessage(data?.alreadyUnbound ? `设备 ${finalDeviceId} 已是未绑定状态。` : `设备 ${finalDeviceId} 已删除绑定。`)
      await loadDevices()
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setDeletingDeviceId('')
    }
  }

  return (
    <main className="page-root pair-shell">
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>手表配对绑定</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          手表端获取配对码后，在这里完成设备绑定。绑定成功后，上传将归属到你的账号。
        </p>
        {/* {user?.email && (
          <div className="server-pill" style={{ marginTop: 12 }}>
            <span>当前账号</span>
            <code>{user.email}</code>
          </div>
        )} */}
      </section>

      {/* <section className="panel panel-dark" style={{ marginBottom: 14 }}>
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
      </section> */}

      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>输入配对码</h3>
        <div className="pair-code-wrap">
          <div className="pair-code-grid" onPaste={handlePairPaste}>
            {pairDigits.map((digit, index) => (
              <input
                key={`pair_digit_${index}`}
                ref={node => {
                  pairInputRefs.current[index] = node
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={event => handlePairDigitChange(index, event.target.value)}
                onKeyDown={event => handlePairDigitKeyDown(index, event)}
                className="pair-code-cell"
                aria-label={`配对码第 ${index + 1} 位`}
              />
            ))}
          </div>
          <div className="pair-code-hint">例如 472918，输入满 6 位后按回车可直接绑定</div>
        </div>

        <div className="action-row pair-action-row">
          <button onClick={bindPairCode} disabled={busy || loading || !pairCodeReady} className="ui-btn ui-btn-primary">
            {busy ? '绑定中...' : '绑定设备'}
          </button>
          <button onClick={logout} disabled={busy} className="ui-btn ui-btn-danger">
            退出登录
          </button>
        </div>

        {message && <div className="ui-notice ui-notice-success">{message}</div>}
        {error && <div className="ui-notice ui-notice-error">{error}</div>}
        {meApi.cacheMessage && (
          <div className="ui-notice ui-notice-info">{meApi.cacheMessage}</div>
        )}

        {latestSessionToken && (
          <div className="ui-notice ui-notice-info">
            <div>设备会话：{maskToken(latestSessionToken)}</div>
            <div>过期时间：{formatDateTime(latestSessionExpiresAt)}</div>
          </div>
        )}
      </section>

      <section className="panel panel-dark">
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>已绑定设备</h3>
        {devicesApi.cacheMessage && (
          <div className="ui-notice ui-notice-info">{devicesApi.cacheMessage}</div>
        )}
        {loading || (cacheUserId && devicesApi.isLoading && sortedDevices.length === 0) ? (
          <p className="muted">加载中...</p>
        ) : sortedDevices.length === 0 ? (
          <p className="muted">暂无绑定设备</p>
        ) : (
          <div className="device-grid">
            {sortedDevices.map(item => (
              <div key={`${item.id}_${item.boundAt}`} className="device-card">
                <div><strong>设备标识：</strong>{item.deviceId || '-'}</div>
                <div><strong>设备型号：</strong>{item.deviceModel || '未知型号'}</div>
                <div><strong>状态：</strong>{statusText(item.status)}</div>
                <div><strong>绑定时间：</strong>{formatDateTime(item.boundAt)}</div>
                <div className="action-row" style={{ marginTop: 8 }}>
                  <button
                    className="ui-btn ui-btn-danger"
                    onClick={() => unbindDevice(item)}
                    disabled={busy || loading || deletingDeviceId === String(item.id || '')}
                  >
                    {deletingDeviceId === String(item.id || '') ? '删除中...' : '删除设备'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
