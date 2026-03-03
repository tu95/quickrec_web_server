function readEnv(name) {
  return String(process.env[name] || '').trim()
}

function readBoolEnv(name, fallback) {
  const raw = readEnv(name).toLowerCase()
  if (!raw) return !!fallback
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return !!fallback
}

function readIntEnv(name, fallback, min, max) {
  const raw = readEnv(name)
  const parsed = raw ? Number(raw) : Number(fallback)
  if (!Number.isFinite(parsed)) return Number(fallback)
  let value = Math.floor(parsed)
  if (Number.isFinite(min)) value = Math.max(value, Number(min))
  if (Number.isFinite(max)) value = Math.min(value, Number(max))
  return value
}

export function getSecurityConfig() {
  const turnstileSiteKey = readEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY')
  const turnstileEnabled = readBoolEnv(
    'TURNSTILE_ENABLED',
    readBoolEnv('NEXT_PUBLIC_TURNSTILE_ENABLED', !!turnstileSiteKey)
  )
  return {
    pair: {
      codeLength: readIntEnv('PAIR_CODE_LENGTH', 6, 6, 12),
      codeTtlSec: readIntEnv('PAIR_CODE_TTL_SEC', 600, 60, 3600),
      statusSessionIssueWindowSec: readIntEnv('PAIR_STATUS_SESSION_ISSUE_WINDOW_SEC', 180, 30, 1800),
      // 开发阶段默认拉长设备会话，避免已绑定设备频繁重新配对。
      deviceSessionTtlSec: readIntEnv('DEVICE_SESSION_TTL_SEC', 10 * 365 * 24 * 60 * 60, 600, 50 * 365 * 24 * 60 * 60)
    },
    rateLimit: {
      pairCode: {
        max: readIntEnv('RL_PAIR_CODE_MAX', 10000, 1, 10000),
        windowSec: readIntEnv('RL_PAIR_CODE_WINDOW_SEC', 60, 1, 3600)
      },
      pairStatus: {
        max: readIntEnv('RL_PAIR_STATUS_MAX', 10000, 1, 10000),
        windowSec: readIntEnv('RL_PAIR_STATUS_WINDOW_SEC', 60, 1, 3600)
      },
      bind: {
        max: readIntEnv('RL_BIND_MAX', 10000, 1, 10000),
        windowSec: readIntEnv('RL_BIND_WINDOW_SEC', 300, 1, 3600 * 24)
      },
      auth: {
        max: readIntEnv('RL_AUTH_MAX', 10000, 1, 10000),
        windowSec: readIntEnv('RL_AUTH_WINDOW_SEC', 300, 1, 3600 * 24)
      }
    },
    turnstile: {
      enabled: turnstileEnabled,
      secretKey: readEnv('TURNSTILE_SECRET_KEY'),
      siteKey: turnstileSiteKey,
      verifyTimeoutMs: readIntEnv('TURNSTILE_VERIFY_TIMEOUT_MS', 5000, 1000, 20000),
      required: {
        login: readBoolEnv('TURNSTILE_LOGIN_REQUIRED', true),
        register: readBoolEnv('TURNSTILE_REGISTER_REQUIRED', true),
        forgotPassword: readBoolEnv('TURNSTILE_FORGOT_REQUIRED', true),
        resendConfirmation: readBoolEnv('TURNSTILE_RESEND_REQUIRED', false)
      }
    }
  }
}
