function toText(raw) {
  return String(raw || '').trim()
}

function toLower(raw) {
  return toText(raw).toLowerCase()
}

function isNetworkLike(lower) {
  return (
    lower.includes('fetch failed') ||
    lower.includes('connect timeout') ||
    lower.includes('network') ||
    lower.includes('timed out') ||
    lower.includes('econn') ||
    lower.includes('und_err')
  )
}

export function normalizeAuthApiError(rawError, scene) {
  const text = toText(rawError)
  const lower = toLower(rawError)
  const action = String(scene || 'auth')

  if (!text) {
    return {
      status: 400,
      error: '请求失败，请稍后重试。'
    }
  }

  if (isNetworkLike(lower)) {
    return {
      status: 503,
      error: '认证服务连接失败，请稍后重试。'
    }
  }

  if (lower.includes('email rate limit exceeded')) {
    return {
      status: 429,
      error: '邮件发送过于频繁，请稍后再试。若你已接入 Brevo，请到 Supabase Auth -> SMTP 检查 Custom SMTP 是否已启用并生效。'
    }
  }

  if (lower.includes('rate limit') || lower.includes('too many')) {
    return {
      status: 429,
      error: '操作太频繁，请稍后再试。'
    }
  }

  if (lower.includes('email not confirmed')) {
    return {
      status: 403,
      error: '邮箱还未完成验证。请先去邮箱点击确认链接，再回来登录。'
    }
  }

  if (lower.includes('invalid login credentials')) {
    return {
      status: 401,
      error: '邮箱或密码不正确，请检查后重试。'
    }
  }

  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return {
      status: 409,
      error: '该邮箱已注册，请直接登录或使用找回密码。'
    }
  }

  if (
    lower.includes('smtp') ||
    lower.includes('error sending') ||
    lower.includes('mailer error') ||
    lower.includes('failed to send')
  ) {
    return {
      status: 502,
      error: '邮件服务暂时不可用，请稍后再试；如持续失败，请检查 Supabase 的 Custom SMTP 配置。'
    }
  }

  if (lower.includes('captcha') || lower.includes('turnstile')) {
    return {
      status: 400,
      error: '人机验证失败，请刷新后重试。'
    }
  }

  if (action === 'login') {
    return {
      status: 401,
      error: text || '登录失败，请稍后重试。'
    }
  }

  return {
    status: 400,
    error: text
  }
}

