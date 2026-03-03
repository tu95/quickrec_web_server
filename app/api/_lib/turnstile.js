import { getClientIp } from './rate-limit'
import { getSecurityConfig } from './security-config'

function isSceneRequired(requiredMap, scene) {
  const key = String(scene || '').trim()
  if (!key) return false
  return !!requiredMap[key]
}

function normalizeTurnstileErrorCodes(raw) {
  return Array.isArray(raw) ? raw.map(item => String(item || '').trim().toLowerCase()) : []
}

function buildTurnstileError(errorCodes) {
  const codes = normalizeTurnstileErrorCodes(errorCodes)
  if (codes.includes('timeout-or-duplicate')) {
    return '人机验证已过期，请重试'
  }
  if (codes.includes('missing-input-response') || codes.includes('invalid-input-response')) {
    return '请先完成人机验证'
  }
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    return '服务端验证码配置错误，请联系管理员'
  }
  return '人机验证失败，请重试'
}

export async function verifyTurnstileToken(request, token, scene) {
  const cfg = getSecurityConfig().turnstile
  const required = cfg.enabled && isSceneRequired(cfg.required, scene)
  if (!required) {
    return { ok: true, skipped: true }
  }
  if (!cfg.secretKey) {
    return { ok: false, status: 500, error: 'Turnstile 未配置 TURNSTILE_SECRET_KEY' }
  }
  const safeToken = String(token || '').trim()
  if (!safeToken) {
    return { ok: false, status: 400, error: '请先完成人机验证' }
  }

  const form = new URLSearchParams()
  form.set('secret', cfg.secretKey)
  form.set('response', safeToken)
  const ip = getClientIp(request)
  if (ip) form.set('remoteip', ip)

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    try {
      controller.abort()
    } catch {}
  }, Number(cfg.verifyTimeoutMs) || 5000)

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString(),
      signal: controller.signal
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) {
      return { ok: false, status: 502, error: '人机验证服务不可用，请稍后再试' }
    }
    if (data.success === true) {
      return { ok: true, skipped: false }
    }
    return {
      ok: false,
      status: 403,
      error: buildTurnstileError(data['error-codes'])
    }
  } catch {
    return { ok: false, status: 502, error: '人机验证服务超时，请稍后再试' }
  } finally {
    clearTimeout(timeout)
  }
}
