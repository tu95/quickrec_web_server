import { sendPasswordResetEmail } from '../../_lib/user-auth'
import { buildAuthSecurityBlockResponse } from '../../_lib/auth-security'
import { normalizeAuthApiError } from '../../_lib/auth-error-map'

function getRequestOrigin(request) {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`
  }
  const host = request.headers.get('host')
  if (host) {
    const proto = forwardedProto || (request.url.startsWith('https://') ? 'https' : 'http')
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '').trim()
    if (!email) {
      return Response.json(
        { success: false, error: '邮箱不能为空' },
        { status: 400 }
      )
    }
    const blocked = await buildAuthSecurityBlockResponse({
      request,
      body,
      scene: 'forgotPassword',
      email
    })
    if (blocked) return blocked
    const origin = getRequestOrigin(request)
    await sendPasswordResetEmail(email, `${origin}/login?mode=reset`)
    return Response.json({
      success: true,
      message: '重置密码邮件已发送，请检查邮箱'
    })
  } catch (error) {
    const normalized = normalizeAuthApiError(error?.message || error, 'forgotPassword')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
