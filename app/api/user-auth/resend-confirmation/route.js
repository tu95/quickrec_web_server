import { resendSignupConfirmation } from '../../_lib/user-auth'
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
      scene: 'resendConfirmation',
      email
    })
    if (blocked) return blocked
    const origin = getRequestOrigin(request)
    await resendSignupConfirmation(email, `${origin}/login`)
    return Response.json({
      success: true,
      message: '确认邮件已发送，请检查邮箱'
    })
  } catch (error) {
    const normalized = normalizeAuthApiError(error?.message || error, 'resendConfirmation')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
